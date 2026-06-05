# Business Card Upload → Auto-Extract → Meeting Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "명함(business card)" upload mode to the meeting file-upload flow that runs server-side Vision OCR and auto-records the recognized people as structured meeting contacts (and syncs their names into `meeting.attendees`).

**Architecture:** Card image uploads through the existing attachment endpoint with `category=business_card` (image preserved as an attachment). The controller enqueues an async `CardExtractionJob`, which calls `CardExtractionService` (dedicated Anthropic vision call, decoupled from the per-user summary LLM), creates `MeetingContact` rows (all fields + `extra` json + `raw_text`), non-destructively appends names to `meeting.attendees`, and broadcasts `contacts_updated` over the existing meeting ActionCable channel. The frontend shows a contacts panel that fetches `/meetings/:id/contacts` and refetches on the broadcast. OCR runs **once** per upload; results are persisted (no re-OCR).

**Tech Stack:** Rails 8 (ActiveJob `:async` dev / `:inline` test / `solid_queue` prod, ActionCable), `anthropic` ruby gem v1.28.0 (vision image blocks), React + Vite + Zustand + `ky` + `@rails/actioncable`, RSpec + FactoryBot (backend), Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-05-business-card-contact-extraction-design.md`

---

## Key decisions locked in (from spec + codebase patterns)

- **Storage:** new `meeting_contacts` table is the source of truth; `meeting.attendees` (free text) is synced names-only, append-only, non-destructive.
- **Vision routing:** dedicated `Anthropic::Client` built from `ENV["ANTHROPIC_AUTH_TOKEN"]` + `ENV["VISION_LLM_MODEL"]` (default `claude-sonnet-4-20250514`). Do NOT use `LlmService` / per-user config (it may be a text-only CLI provider). If no key → raise → job broadcasts failure, image attachment is preserved.
- **No account creation:** `MeetingParticipant` is untouched; contacts are external info only.
- **Realtime:** `ContactsSection` opens its **own** `TranscriptionChannel` subscription (independent of `useTranscription`) so it works on any meeting detail page. `transcription.ts` is left unmodified (its switch ignores unknown types harmlessly).
- **Contacts read endpoint is separate** from `meeting_json` (less risk): `GET /meetings/:id/contacts`.

## File Structure

**Backend (create):**
- `backend/db/migrate/<ts>_create_meeting_contacts.rb` — schema
- `backend/app/models/meeting_contact.rb` — model
- `backend/app/services/card_extraction_service.rb` — vision OCR + JSON parse
- `backend/app/jobs/card_extraction_job.rb` — async orchestration
- `backend/app/controllers/api/v1/meeting_contacts_controller.rb` — index/update/destroy
- `backend/spec/factories/meeting_contacts.rb`, `backend/spec/factories/meeting_attachments.rb`
- `backend/spec/models/meeting_contact_spec.rb`, `backend/spec/services/card_extraction_service_spec.rb`, `backend/spec/jobs/card_extraction_job_spec.rb`, `backend/spec/requests/api/v1/meeting_contacts_spec.rb`

**Backend (modify):**
- `backend/app/models/meeting.rb` — `has_many :meeting_contacts`, `append_attendee!`
- `backend/app/models/meeting_attachment.rb` — add `"business_card"` to `CATEGORIES`
- `backend/app/controllers/api/v1/meeting_attachments_controller.rb` — enqueue job on `business_card`
- `backend/config/routes.rb` — nested `contacts` resource

**Frontend (create):**
- `frontend/src/api/contacts.ts` + `frontend/src/__tests__/api/contacts.test.ts`
- `frontend/src/hooks/useContacts.ts`
- `frontend/src/components/meeting/ContactsSection.tsx` + `ContactCard.tsx`
- `frontend/src/components/meeting/ContactsSection.test.tsx`

**Frontend (modify):**
- `frontend/src/api/attachments.ts` — add `'business_card'` to `AttachmentCategory`
- `frontend/src/components/meeting/AddFileDialog.tsx` — 명함 chip + image-only restriction
- `frontend/src/components/meeting/AttachmentSection.tsx` — add 명함 category tab
- `frontend/src/pages/MeetingPage.tsx` — render `<ContactsSection />`

---

## Task 1: `meeting_contacts` table + model + Meeting wiring

**Files:**
- Create: `backend/db/migrate/<ts>_create_meeting_contacts.rb`
- Create: `backend/app/models/meeting_contact.rb`
- Modify: `backend/app/models/meeting.rb:12` (associations) and add `append_attendee!`
- Create: `backend/spec/factories/meeting_contacts.rb`
- Test: `backend/spec/models/meeting_contact_spec.rb`

> ⚠️ **Migration trap:** the dev Rails server (port 13323) returns 500 (PendingMigrationError) on every request while an un-run migration sits in `db/migrate`. Run `bin/rails db:migrate` **immediately** after creating the file (or stop the server first).

- [ ] **Step 1: Generate the migration file**

Run: `cd backend && bin/rails generate migration CreateMeetingContacts`

Then replace the generated file's contents with:

```ruby
class CreateMeetingContacts < ActiveRecord::Migration[8.0]
  def change
    create_table :meeting_contacts do |t|
      t.references :meeting, null: false, foreign_key: true
      t.string :name
      t.string :company
      t.string :department
      t.string :title
      t.string :mobile
      t.string :phone
      t.string :fax
      t.string :email
      t.string :website
      t.text   :address
      t.json   :extra
      t.text   :raw_text
      t.bigint :source_attachment_id
      t.bigint :created_by_id, null: false
      t.timestamps
    end

    add_index :meeting_contacts, :source_attachment_id
  end
end
```

- [ ] **Step 2: Run the migration (closes the 500 window)**

Run: `cd backend && bin/rails db:migrate`
Expected: `create_table(:meeting_contacts)` runs, `db/schema.rb` updated, no error.

- [ ] **Step 3: Write the failing model spec**

Create `backend/spec/models/meeting_contact_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe MeetingContact, type: :model do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  it "belongs to a meeting and stores all card fields incl. extra/raw_text" do
    c = meeting.meeting_contacts.create!(
      name: "홍길동", company: "또박", department: "개발", title: "팀장",
      mobile: "010-1111-2222", phone: "02-000-0000", fax: "02-000-0001",
      email: "hong@ddobak.io", website: "https://ddobak.io", address: "서울",
      extra: { "kakao" => "hong" }, raw_text: "홍길동 또박 개발 팀장 ...",
      created_by_id: user.id
    )
    expect(c.reload.extra).to eq("kakao" => "hong")
    expect(c.raw_text).to include("홍길동")
    expect(meeting.meeting_contacts).to include(c)
  end

  it "allows a raw_text-only contact (recognition failure fallback)" do
    c = meeting.meeting_contacts.create!(raw_text: "읽은 원문만", created_by_id: user.id)
    expect(c).to be_persisted
    expect(c.display_label).to eq("(미인식 명함)")
  end
end
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd backend && bundle exec rspec spec/models/meeting_contact_spec.rb`
Expected: FAIL — `uninitialized constant MeetingContact`.

- [ ] **Step 5: Create the model**

Create `backend/app/models/meeting_contact.rb`:

```ruby
class MeetingContact < ApplicationRecord
  belongs_to :meeting
  belongs_to :source_attachment, class_name: "MeetingAttachment", optional: true
  belongs_to :creator, class_name: "User", foreign_key: "created_by_id"

  # 빈 명함(인식 실패)도 raw_text 보존을 위해 name presence를 강제하지 않는다.
  def display_label
    [ name.presence, company.presence ].compact.join(" / ").presence || "(미인식 명함)"
  end
end
```

- [ ] **Step 6: Wire the Meeting association + `append_attendee!`**

In `backend/app/models/meeting.rb`, after line 12 (`has_many :meeting_attachments, dependent: :destroy`) add:

```ruby
  has_many :meeting_contacts, dependent: :destroy
```

Then add this method inside the `Meeting` class (e.g. after `host_participant`):

```ruby
  # 명함에서 인식한 참석자 이름을 attendees 자유텍스트에 비파괴 append.
  # 기존 사용자 입력은 지우지 않고, 같은 이름이 이미 있으면 skip(중복 방지).
  def append_attendee!(name, company = nil)
    name = name.to_s.strip
    return if name.blank?

    existing = attendees.to_s
    return if existing.include?(name)

    label   = company.to_s.strip.present? ? "#{name} (#{company.to_s.strip})" : name
    updated = existing.strip.empty? ? label : "#{existing}, #{label}"
    update_column(:attendees, updated)
  end
```

- [ ] **Step 7: Create the factory**

Create `backend/spec/factories/meeting_contacts.rb`:

```ruby
FactoryBot.define do
  factory :meeting_contact do
    association :meeting
    name { "홍길동" }
    company { "또박" }
    created_by_id { meeting.created_by_id }
  end
end
```

- [ ] **Step 8: Run the model spec to verify it passes**

Run: `cd backend && bundle exec rspec spec/models/meeting_contact_spec.rb`
Expected: PASS (2 examples).

- [ ] **Step 9: Add `append_attendee!` spec**

Append to `backend/spec/models/meeting_contact_spec.rb` (new top-level describe or inside a `describe Meeting`):

```ruby
RSpec.describe Meeting, "#append_attendee!", type: :model do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, attendees: nil) }

  it "appends name (company), skips duplicates, preserves existing text" do
    meeting.append_attendee!("홍길동", "또박")
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")

    meeting.append_attendee!("홍길동", "다른회사")        # dup name → skip
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")

    meeting.update_column(:attendees, "김기존")             # user-entered text
    meeting.append_attendee!("이영희")
    expect(meeting.reload.attendees).to eq("김기존, 이영희")
  end

  it "no-ops on blank name" do
    meeting.append_attendee!("  ")
    expect(meeting.reload.attendees).to be_nil
  end
end
```

- [ ] **Step 10: Run and commit**

Run: `cd backend && bundle exec rspec spec/models/meeting_contact_spec.rb`
Expected: PASS (4 examples).

```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/meeting_contact.rb \
        backend/app/models/meeting.rb backend/spec/factories/meeting_contacts.rb \
        backend/spec/models/meeting_contact_spec.rb
git commit -m "feat(cards): meeting_contacts table + model + attendees append"
```

---

## Task 2: `CardExtractionService` (Vision OCR + JSON parse)

**Files:**
- Create: `backend/app/services/card_extraction_service.rb`
- Test: `backend/spec/services/card_extraction_service_spec.rb`

Design: `new(attachment).call` returns `Array<Hash>` (symbol keys). The raw vision HTTP call is isolated in `call_vision(base64, media_type)` so specs stub it without hitting the network. `extra` collects any keys the model returns beyond the fixed set; `raw_text` always preserved.

- [ ] **Step 1: Write the failing service spec**

Create `backend/spec/services/card_extraction_service_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe CardExtractionService do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:attachment) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "business_card", display_name: "card.jpg",
      original_filename: "card.jpg", content_type: "image/jpeg",
      file_size: 3, file_path: "/tmp/does-not-matter.jpg",
      uploaded_by_id: user.id, position: 1
    )
  end

  subject(:service) { described_class.new(attachment) }

  before do
    allow(File).to receive(:binread).and_return("rawbytes")
    ENV["ANTHROPIC_AUTH_TOKEN"] = "sk-test"
  end

  it "parses a JSON object into one contact with all fields + extra + raw_text" do
    allow(service).to receive(:call_vision).and_return(<<~JSON)
      {"name":"홍길동","company":"또박","department":"개발","title":"팀장",
       "mobile":"010-1","phone":"02-2","fax":"02-3","email":"h@x.io",
       "website":"https://x.io","address":"서울","kakao":"hong",
       "raw_text":"홍길동 또박 개발팀장"}
    JSON

    result = service.call
    expect(result.size).to eq(1)
    c = result.first
    expect(c[:name]).to eq("홍길동")
    expect(c[:title]).to eq("팀장")
    expect(c[:extra]).to eq("kakao" => "hong")           # unknown key → extra
    expect(c[:raw_text]).to include("홍길동")
  end

  it "parses a JSON array (multiple cards in one image)" do
    allow(service).to receive(:call_vision).and_return('[{"name":"A"},{"name":"B"}]')
    expect(service.call.map { |c| c[:name] }).to eq(%w[A B])
  end

  it "retries once on bad JSON then falls back to raw_text-only" do
    call_count = 0
    allow(service).to receive(:call_vision) { call_count += 1; "not json at all" }
    result = service.call
    expect(call_count).to eq(2)                            # original + 1 retry
    expect(result.size).to eq(1)
    expect(result.first[:raw_text]).to eq("not json at all")
    expect(result.first[:name]).to be_nil
  end

  it "raises when no vision API key is configured" do
    ENV["ANTHROPIC_AUTH_TOKEN"] = ""
    expect { service.send(:vision_api_key!) }.to raise_error(CardExtractionService::VisionUnavailable)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && bundle exec rspec spec/services/card_extraction_service_spec.rb`
Expected: FAIL — `uninitialized constant CardExtractionService`.

- [ ] **Step 3: Implement the service**

Create `backend/app/services/card_extraction_service.rb`:

```ruby
require "base64"

# 명함 이미지 → Vision OCR(Anthropic) → 구조화 연락처 배열.
# per-user 요약 LLM과 분리: 전용 Anthropic 클라이언트(ANTHROPIC_AUTH_TOKEN + vision 모델).
class CardExtractionService
  class VisionUnavailable < StandardError; end

  DEFAULT_MODEL = "claude-sonnet-4-20250514"
  MAX_TOKENS = 2000

  FIXED_KEYS = %w[name company department title mobile phone fax email website address raw_text].freeze

  MEDIA_TYPES = {
    "image/jpeg" => :"image/jpeg",
    "image/png"  => :"image/png",
    "image/gif"  => :"image/gif",
    "image/webp" => :"image/webp"
  }.freeze

  SYSTEM_PROMPT = <<~PROMPT.freeze
    당신은 명함 OCR 추출기다. 이미지의 명함에서 정보를 빠짐없이 추출한다.
    반드시 JSON만 출력한다(설명/마크다운 금지). 명함이 여러 장이면 JSON 배열로.
    각 명함 객체 키:
      name, company, department, title, mobile, phone, fax, email, website, address, raw_text
    그 외에 명함에 있는 추가 정보(SNS, 메신저ID, 추가 번호 등)는 해당 키 그대로 같은 객체에 넣는다.
    raw_text 에는 명함에서 읽은 모든 텍스트 원문을 넣는다.
    못 읽은 필드는 생략하거나 null. 값이 한국어/영어 혼용이면 보이는 그대로.
  PROMPT

  USER_TEXT = "이 명함 이미지에서 정보를 추출해 위 형식의 JSON으로만 답하라.".freeze

  def initialize(attachment)
    @attachment = attachment
  end

  def call
    base64     = Base64.strict_encode64(File.binread(@attachment.file_path))
    media_type = MEDIA_TYPES.fetch(@attachment.content_type, :"image/jpeg")

    text = call_vision(base64, media_type)
    parse_contacts(text) || begin
      retry_text = call_vision(base64, media_type)
      parse_contacts(retry_text) || [ { raw_text: retry_text.to_s.strip } ]
    end
  end

  private

  # 분리된 raw 호출 — 스펙에서 stub 한다.
  def call_vision(base64, media_type)
    client = Anthropic::Client.new(api_key: vision_api_key!)
    resp = client.messages.create(
      model: ENV.fetch("VISION_LLM_MODEL", DEFAULT_MODEL),
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [ {
        role: "user",
        content: [
          { type: :text, text: USER_TEXT },
          { type: :image, source: { type: :base64, media_type: media_type, data: base64 } }
        ]
      } ]
    )
    resp.content.first.text
  end

  def vision_api_key!
    key = ENV["ANTHROPIC_AUTH_TOKEN"].to_s
    raise VisionUnavailable, "ANTHROPIC_AUTH_TOKEN 미설정 — 명함 인식 불가" if key.strip.empty?
    key
  end

  # 성공 시 Array<Hash(symbol keys)>, 실패(파싱불가) 시 nil
  def parse_contacts(text)
    json = extract_json(text)
    data = JSON.parse(json)
    list = data.is_a?(Array) ? data : [ data ]
    list.map { |h| normalize(h) }
  rescue JSON::ParserError, TypeError
    nil
  end

  def normalize(hash)
    return { raw_text: nil } unless hash.is_a?(Hash)
    contact = {}
    FIXED_KEYS.each { |k| contact[k.to_sym] = hash[k].presence }
    extra = hash.reject { |k, _| FIXED_KEYS.include?(k.to_s) }
    contact[:extra] = extra.presence || {}
    contact
  end

  def extract_json(text)
    s = text.to_s.strip
    if (m = s.match(/```(?:json)?\s*([\s\S]*?)```/))
      m[1].strip
    else
      s
    end
  end
end
```

- [ ] **Step 4: Run the service spec to verify it passes**

Run: `cd backend && bundle exec rspec spec/services/card_extraction_service_spec.rb`
Expected: PASS (4 examples).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/card_extraction_service.rb \
        backend/spec/services/card_extraction_service_spec.rb
git commit -m "feat(cards): CardExtractionService vision OCR + JSON parse"
```

---

## Task 3: `CardExtractionJob`

**Files:**
- Create: `backend/app/jobs/card_extraction_job.rb`
- Test: `backend/spec/jobs/card_extraction_job_spec.rb`

- [ ] **Step 1: Write the failing job spec**

Create `backend/spec/jobs/card_extraction_job_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe CardExtractionJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, attendees: nil) }
  let(:attachment) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "business_card", display_name: "card.jpg",
      original_filename: "card.jpg", content_type: "image/jpeg",
      file_size: 3, file_path: "/tmp/x.jpg", uploaded_by_id: user.id, position: 1
    )
  end

  it "creates contacts, syncs attendees, and broadcasts contacts_updated" do
    allow_any_instance_of(CardExtractionService).to receive(:call).and_return([
      { name: "홍길동", company: "또박", title: "팀장", email: "h@x.io",
        extra: { "kakao" => "hong" }, raw_text: "원문" }
    ])
    expect(ActionCable.server).to receive(:broadcast).with(
      meeting.transcription_stream, hash_including(type: "contacts_updated")
    )

    described_class.perform_now(attachment.id)

    c = meeting.meeting_contacts.last
    expect(c.name).to eq("홍길동")
    expect(c.source_attachment_id).to eq(attachment.id)
    expect(c.created_by_id).to eq(user.id)
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")
  end

  it "broadcasts card_extraction_failed and preserves the attachment on error" do
    allow_any_instance_of(CardExtractionService).to receive(:call)
      .and_raise(CardExtractionService::VisionUnavailable, "no key")
    expect(ActionCable.server).to receive(:broadcast).with(
      meeting.transcription_stream, hash_including(type: "card_extraction_failed")
    )

    expect { described_class.perform_now(attachment.id) }.not_to raise_error
    expect(MeetingAttachment.exists?(attachment.id)).to be(true)
    expect(meeting.meeting_contacts.count).to eq(0)
  end

  it "no-ops for non-business_card attachments" do
    other = meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "d.pdf",
      original_filename: "d.pdf", content_type: "application/pdf",
      file_size: 3, file_path: "/tmp/d.pdf", uploaded_by_id: user.id, position: 2
    )
    expect_any_instance_of(CardExtractionService).not_to receive(:call)
    described_class.perform_now(other.id)
  end
end
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && bundle exec rspec spec/jobs/card_extraction_job_spec.rb`
Expected: FAIL — `uninitialized constant CardExtractionJob`.

- [ ] **Step 3: Implement the job**

Create `backend/app/jobs/card_extraction_job.rb`:

```ruby
class CardExtractionJob < ApplicationJob
  queue_as :card_extraction

  def perform(attachment_id)
    attachment = MeetingAttachment.find_by(id: attachment_id)
    return unless attachment&.category == "business_card"

    meeting  = attachment.meeting
    contacts = CardExtractionService.new(attachment).call

    contacts.each do |c|
      mc = meeting.meeting_contacts.create!(
        name: c[:name], company: c[:company], department: c[:department],
        title: c[:title], mobile: c[:mobile], phone: c[:phone], fax: c[:fax],
        email: c[:email], website: c[:website], address: c[:address],
        extra: c[:extra] || {}, raw_text: c[:raw_text],
        source_attachment_id: attachment.id, created_by_id: attachment.uploaded_by_id
      )
      meeting.append_attendee!(mc.name, mc.company)
    end

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "contacts_updated", meeting_id: meeting.id }
    )
  rescue => e
    Rails.logger.error "[CardExtractionJob] attachment=#{attachment_id} error=#{e.class}: #{e.message}"
    if attachment&.meeting
      ActionCable.server.broadcast(
        attachment.meeting.transcription_stream,
        { type: "card_extraction_failed", attachment_id: attachment_id, error: e.message }
      )
    end
  end
end
```

- [ ] **Step 4: Run the job spec to verify it passes**

Run: `cd backend && bundle exec rspec spec/jobs/card_extraction_job_spec.rb`
Expected: PASS (3 examples).

- [ ] **Step 5: Commit**

```bash
git add backend/app/jobs/card_extraction_job.rb backend/spec/jobs/card_extraction_job_spec.rb
git commit -m "feat(cards): CardExtractionJob — create contacts, sync attendees, broadcast"
```

---

## Task 4: `business_card` category + enqueue job on upload

**Files:**
- Modify: `backend/app/models/meeting_attachment.rb:24` (`CATEGORIES`)
- Modify: `backend/app/controllers/api/v1/meeting_attachments_controller.rb` (`create_file_attachment`)
- Create: `backend/spec/factories/meeting_attachments.rb`
- Test: `backend/spec/requests/api/v1/meeting_attachments_spec.rb` (add one example)

- [ ] **Step 1: Add the category constant**

In `backend/app/models/meeting_attachment.rb`, change:

```ruby
  CATEGORIES = %w[agenda reference minutes].freeze
```

to:

```ruby
  CATEGORIES = %w[agenda reference minutes business_card].freeze
```

- [ ] **Step 2: Create the attachment factory (used by the request test)**

Create `backend/spec/factories/meeting_attachments.rb`:

```ruby
FactoryBot.define do
  factory :meeting_attachment do
    association :meeting
    kind { "file" }
    category { "reference" }
    display_name { "doc.pdf" }
    original_filename { "doc.pdf" }
    content_type { "application/pdf" }
    file_size { 123 }
    file_path { "/tmp/doc.pdf" }
    position { 1 }
    uploaded_by_id { meeting.created_by_id }
  end
end
```

- [ ] **Step 3: Write the failing request spec for enqueue**

Add to `backend/spec/requests/api/v1/meeting_attachments_spec.rb` (inside the top-level `describe`, reuse its `let(:user)`/`let(:meeting)`/`before { login_as(user) }`/`around` tmpdir block):

```ruby
  it "enqueues CardExtractionJob when category is business_card" do
    file = Rack::Test::UploadedFile.new(
      StringIO.new("\xFF\xD8\xFF\x00fakejpeg"), "image/jpeg", original_filename: "card.jpg"
    )
    expect {
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "business_card", file: file }
    }.to have_enqueued_job(CardExtractionJob)
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["attachment"]["category"]).to eq("business_card")
  end
```

> If `Rack::Test::UploadedFile` needs a real path, instead write the bytes to a tempfile: `f = Tempfile.new(["card", ".jpg"]); f.binmode; f.write("\xFF\xD8\xFF\x00"); f.rewind; Rack::Test::UploadedFile.new(f.path, "image/jpeg")`.

- [ ] **Step 4: Run it to verify it fails**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_attachments_spec.rb -e "business_card"`
Expected: FAIL — job not enqueued (the controller doesn't enqueue yet).

- [ ] **Step 5: Enqueue the job in the controller**

In `backend/app/controllers/api/v1/meeting_attachments_controller.rb`, inside `create_file_attachment`, change the success branch:

```ruby
        if attachment.save
          render json: { attachment: attachment_json(attachment) }, status: :created
        else
```

to:

```ruby
        if attachment.save
          CardExtractionJob.perform_later(attachment.id) if attachment.category == "business_card"
          render json: { attachment: attachment_json(attachment) }, status: :created
        else
```

- [ ] **Step 6: Run the request spec to verify it passes**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_attachments_spec.rb`
Expected: PASS (existing examples + the new one).

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/meeting_attachment.rb \
        backend/app/controllers/api/v1/meeting_attachments_controller.rb \
        backend/spec/factories/meeting_attachments.rb \
        backend/spec/requests/api/v1/meeting_attachments_spec.rb
git commit -m "feat(cards): business_card category triggers CardExtractionJob on upload"
```

---

## Task 5: `MeetingContactsController` + routes (index/update/destroy)

**Files:**
- Modify: `backend/config/routes.rb` (nested `contacts` resource)
- Create: `backend/app/controllers/api/v1/meeting_contacts_controller.rb`
- Test: `backend/spec/requests/api/v1/meeting_contacts_spec.rb`

- [ ] **Step 1: Add the route**

In `backend/config/routes.rb`, inside the `resources :meetings ... do` block, immediately after the `resources :attachments ... end` block, add:

```ruby
      resources :contacts, only: %i[index update destroy],
                controller: "meeting_contacts"
```

- [ ] **Step 2: Write the failing request spec**

Create `backend/spec/requests/api/v1/meeting_contacts_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "Api::V1::MeetingContacts", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  describe "as the owner" do
    before { login_as(user) }

    it "lists contacts" do
      create(:meeting_contact, meeting: meeting, name: "홍길동")
      get "/api/v1/meetings/#{meeting.id}/contacts"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["contacts"].map { |c| c["name"] }).to include("홍길동")
    end

    it "updates a contact (OCR 교정)" do
      c = create(:meeting_contact, meeting: meeting, name: "오타")
      patch "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}", params: { name: "정정" }
      expect(response).to have_http_status(:ok)
      expect(c.reload.name).to eq("정정")
    end

    it "deletes a contact" do
      c = create(:meeting_contact, meeting: meeting)
      delete "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}"
      expect(response).to have_http_status(:no_content)
      expect(MeetingContact.exists?(c.id)).to be(false)
    end
  end

  describe "as a non-owner (shared meeting → read ok, control forbidden)" do
    let(:other) { create(:user) }
    before { login_as(other) }

    it "can read but cannot update" do
      c = create(:meeting_contact, meeting: meeting, name: "홍길동")
      get "/api/v1/meetings/#{meeting.id}/contacts"
      expect(response).to have_http_status(:ok)

      patch "/api/v1/meetings/#{meeting.id}/contacts/#{c.id}", params: { name: "해킹" }
      expect(response).to have_http_status(:forbidden)
      expect(c.reload.name).to eq("홍길동")
    end
  end
end
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_contacts_spec.rb`
Expected: FAIL — routing error / `uninitialized constant Api::V1::MeetingContactsController`.

- [ ] **Step 4: Implement the controller**

Create `backend/app/controllers/api/v1/meeting_contacts_controller.rb`:

```ruby
module Api
  module V1
    class MeetingContactsController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[update destroy]
      before_action :set_contact, only: %i[update destroy]

      def index
        contacts = @meeting.meeting_contacts.order(:created_at)
        render json: { contacts: contacts.map { |c| contact_json(c) } }
      end

      def update
        if @contact.update(contact_params)
          render json: { contact: contact_json(@contact) }
        else
          render json: { errors: @contact.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @contact.destroy
        head :no_content
      end

      private

      def set_contact
        @contact = @meeting.meeting_contacts.find_by(id: params[:id])
        render json: { error: "Contact not found" }, status: :not_found unless @contact
      end

      def contact_params
        params.permit(:name, :company, :department, :title,
                      :mobile, :phone, :fax, :email, :website, :address)
      end

      def contact_json(c)
        {
          id: c.id,
          meeting_id: c.meeting_id,
          name: c.name,
          company: c.company,
          department: c.department,
          title: c.title,
          mobile: c.mobile,
          phone: c.phone,
          fax: c.fax,
          email: c.email,
          website: c.website,
          address: c.address,
          extra: c.extra || {},
          raw_text: c.raw_text,
          source_attachment_id: c.source_attachment_id,
          created_at: c.created_at,
          updated_at: c.updated_at
        }
      end
    end
  end
end
```

- [ ] **Step 5: Run the request spec to verify it passes**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_contacts_spec.rb`
Expected: PASS (5 examples).

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd backend && bundle exec rspec`
Expected: all green (prior count + new examples).

- [ ] **Step 7: Commit**

```bash
git add backend/config/routes.rb \
        backend/app/controllers/api/v1/meeting_contacts_controller.rb \
        backend/spec/requests/api/v1/meeting_contacts_spec.rb
git commit -m "feat(cards): MeetingContacts API (index/update/destroy) + routes"
```

---

## Task 6: Frontend `api/contacts.ts` + test

**Files:**
- Modify: `frontend/src/api/attachments.ts:4` (`AttachmentCategory`)
- Create: `frontend/src/api/contacts.ts`
- Test: `frontend/src/__tests__/api/contacts.test.ts`

- [ ] **Step 1: Add `business_card` to the category type**

In `frontend/src/api/attachments.ts`, change:

```ts
export type AttachmentCategory = 'agenda' | 'reference' | 'minutes'
```

to:

```ts
export type AttachmentCategory = 'agenda' | 'reference' | 'minutes' | 'business_card'
```

- [ ] **Step 2: Write the failing api test**

Create `frontend/src/__tests__/api/contacts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { get, patch, del } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('ky', () => {
  const instance = { get, post: vi.fn(), patch, delete: del }
  return { default: { create: vi.fn(() => instance) }, __esModule: true }
})

describe('contacts API', () => {
  beforeEach(() => {
    get.mockReset(); patch.mockReset(); del.mockReset()
  })

  it('getContacts returns the contacts array', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({ contacts: [{ id: 1, name: '홍길동' }] }) })
    const { getContacts } = await import('../../api/contacts')
    const result = await getContacts(7)
    expect(get).toHaveBeenCalledWith('meetings/7/contacts')
    expect(result).toEqual([{ id: 1, name: '홍길동' }])
  })

  it('updateContact PATCHes and returns the contact', async () => {
    patch.mockReturnValue({ json: () => Promise.resolve({ contact: { id: 1, name: '정정' } }) })
    const { updateContact } = await import('../../api/contacts')
    const result = await updateContact(7, 1, { name: '정정' })
    expect(patch).toHaveBeenCalledWith('meetings/7/contacts/1', { json: { name: '정정' } })
    expect(result).toEqual({ id: 1, name: '정정' })
  })

  it('deleteContact DELETEs', async () => {
    del.mockReturnValue({ json: () => Promise.resolve({}) })
    const { deleteContact } = await import('../../api/contacts')
    await deleteContact(7, 1)
    expect(del).toHaveBeenCalledWith('meetings/7/contacts/1')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/api/contacts.test.ts`
Expected: FAIL — cannot resolve `../../api/contacts`.

- [ ] **Step 4: Implement the api module**

Create `frontend/src/api/contacts.ts`:

```ts
import apiClient from './client'

export interface MeetingContact {
  id: number
  meeting_id: number
  name: string | null
  company: string | null
  department: string | null
  title: string | null
  mobile: string | null
  phone: string | null
  fax: string | null
  email: string | null
  website: string | null
  address: string | null
  extra: Record<string, unknown>
  raw_text: string | null
  source_attachment_id: number | null
  created_at: string
  updated_at: string
}

export interface UpdateContactParams {
  name?: string | null
  company?: string | null
  department?: string | null
  title?: string | null
  mobile?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  website?: string | null
  address?: string | null
}

export async function getContacts(meetingId: number): Promise<MeetingContact[]> {
  const res = await apiClient
    .get(`meetings/${meetingId}/contacts`)
    .json<{ contacts: MeetingContact[] }>()
  return res.contacts
}

export async function updateContact(
  meetingId: number,
  contactId: number,
  data: UpdateContactParams,
): Promise<MeetingContact> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/contacts/${contactId}`, { json: data })
    .json<{ contact: MeetingContact }>()
  return res.contact
}

export async function deleteContact(meetingId: number, contactId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/contacts/${contactId}`)
}
```

- [ ] **Step 5: Run the api test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/api/contacts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/attachments.ts frontend/src/api/contacts.ts \
        frontend/src/__tests__/api/contacts.test.ts
git commit -m "feat(cards): frontend contacts api + business_card category"
```

---

## Task 7: `useContacts` hook

**Files:**
- Create: `frontend/src/hooks/useContacts.ts`

Mirrors `useAttachments` (module cache + fetchKey refetch) but read/update/delete only.

- [ ] **Step 1: Implement the hook**

Create `frontend/src/hooks/useContacts.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import {
  getContacts,
  updateContact as apiUpdate,
  deleteContact as apiDelete,
  type MeetingContact,
  type UpdateContactParams,
} from '../api/contacts'

// 모듈 레벨 캐시 — 페이지 전환 시 이전 데이터 즉시 표시 (useAttachments와 동일 패턴)
const contactsCache = new Map<number, MeetingContact[]>()

// 변경 알림(pub/sub) — 업로드→비동기 추출 완료를 ActionCable 누락 시에도 폴백으로 반영한다.
const listeners = new Map<number, Set<() => void>>()
export function notifyContactsChanged(meetingId: number) {
  listeners.get(meetingId)?.forEach((fn) => fn())
}

export interface UseContactsReturn {
  contacts: MeetingContact[]
  isLoading: boolean
  error: string | null
  update: (id: number, data: UpdateContactParams) => Promise<void>
  remove: (id: number) => Promise<void>
  refetch: () => void
}

export function useContacts(meetingId: number): UseContactsReturn {
  const [contacts, setContacts] = useState<MeetingContact[]>(() => contactsCache.get(meetingId) ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchKey, setFetchKey] = useState(0)

  const refetch = useCallback(() => setFetchKey((k) => k + 1), [])

  useEffect(() => {
    if (!contactsCache.has(meetingId)) setIsLoading(true)
    setError(null)
    getContacts(meetingId)
      .then((data) => {
        setContacts(data)
        contactsCache.set(meetingId, data)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [meetingId, fetchKey])

  // 폴백 알림 구독 — notifyContactsChanged(meetingId) 호출 시 refetch (ActionCable 누락 대비)
  useEffect(() => {
    const set = listeners.get(meetingId) ?? new Set<() => void>()
    set.add(refetch)
    listeners.set(meetingId, set)
    return () => { set.delete(refetch) }
  }, [meetingId, refetch])

  const update = useCallback(async (id: number, data: UpdateContactParams) => {
    const updated = await apiUpdate(meetingId, id, data)
    setContacts((prev) => {
      const next = prev.map((c) => (c.id === id ? updated : c))
      contactsCache.set(meetingId, next)
      return next
    })
  }, [meetingId])

  const remove = useCallback(async (id: number) => {
    await apiDelete(meetingId, id)
    setContacts((prev) => {
      const next = prev.filter((c) => c.id !== id)
      contactsCache.set(meetingId, next)
      return next
    })
  }, [meetingId])

  return { contacts, isLoading, error, update, remove, refetch }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b --noEmit` (or rely on the build in Task 9). Expected: no new errors in `useContacts.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useContacts.ts
git commit -m "feat(cards): useContacts hook"
```

---

## Task 8: `ContactsSection` + `ContactCard` + realtime + render in MeetingPage

**Files:**
- Create: `frontend/src/components/meeting/ContactCard.tsx`
- Create: `frontend/src/components/meeting/ContactsSection.tsx`
- Modify: `frontend/src/pages/MeetingPage.tsx` (render the section)
- Test: `frontend/src/components/meeting/ContactsSection.test.tsx`

`ContactsSection` fetches via `useContacts`, opens its **own** `TranscriptionChannel` subscription to refetch on `contacts_updated` / `card_extraction_failed`. It renders nothing when there are no contacts (keeps the detail page clean for non-card meetings).

> **Channel verified:** `backend/app/channels/transcription_channel.rb#subscribed` → `determine_role` streams for owner / admin / active host|viewer participant and `reject`s others. The card uploader is always owner/admin/host (gated by `authorize_meeting_control!`), so they always receive the broadcast. **Dual path:** Task 7's `notifyContactsChanged` delayed-refetch fallback (driven from `AddFileDialog`, Task 9) covers any missed websocket message, so the panel updates even without the broadcast — `useContacts` refetches on both the channel message and the notify.

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/meeting/ContactsSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getContacts = vi.fn()
vi.mock('../../api/contacts', () => ({
  getContacts: (...a: unknown[]) => getContacts(...a),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}))

// 독립 채널 구독 — 테스트에선 no-op consumer
vi.mock('../../lib/actionCableAuth', () => ({
  createAuthenticatedConsumer: () => ({
    subscriptions: { create: () => ({ unsubscribe: vi.fn() }) },
    disconnect: vi.fn(),
  }),
}))

import { ContactsSection } from './ContactsSection'

describe('ContactsSection', () => {
  beforeEach(() => getContacts.mockReset())

  it('renders recognized contacts', async () => {
    getContacts.mockResolvedValue([
      { id: 1, meeting_id: 7, name: '홍길동', company: '또박', title: '팀장',
        department: null, mobile: '010-1', phone: null, fax: null, email: 'h@x.io',
        website: null, address: null, extra: {}, raw_text: null,
        source_attachment_id: 9, created_at: '', updated_at: '' },
    ])
    render(<ContactsSection meetingId={7} />)
    expect(await screen.findByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText(/또박/)).toBeInTheDocument()
  })

  it('renders nothing when there are no contacts', async () => {
    getContacts.mockResolvedValue([])
    const { container } = render(<ContactsSection meetingId={7} />)
    // 비동기 fetch가 끝나도 빈 상태면 아무것도 안 그린다
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/meeting/ContactsSection.test.tsx`
Expected: FAIL — cannot resolve `./ContactsSection`.

- [ ] **Step 3: Implement `ContactCard`**

Create `frontend/src/components/meeting/ContactCard.tsx`:

```tsx
import { useState } from 'react'
import { Mail, Phone, Smartphone, Building2, Trash2 } from 'lucide-react'
import type { MeetingContact } from '../../api/contacts'

interface ContactCardProps {
  contact: MeetingContact
  onDelete: (id: number) => void
}

export function ContactCard({ contact, onDelete }: ContactCardProps) {
  const [showRaw, setShowRaw] = useState(false)
  const subtitle = [contact.company, contact.department, contact.title].filter(Boolean).join(' · ')
  const extraEntries = Object.entries(contact.extra ?? {})

  return (
    <div className="w-56 shrink-0 rounded-lg border bg-white p-3 hover:shadow-sm hover:border-blue-300 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{contact.name || '(미인식 명함)'}</p>
          {subtitle && <p className="text-xs text-gray-500 truncate flex items-center gap-1"><Building2 className="w-3 h-3 shrink-0" />{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => onDelete(contact.id)}
          className="text-gray-300 hover:text-red-500 shrink-0"
          aria-label="삭제"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-2 space-y-1 text-xs text-gray-600">
        {contact.mobile && <p className="flex items-center gap-1 truncate"><Smartphone className="w-3 h-3 shrink-0" />{contact.mobile}</p>}
        {contact.phone && <p className="flex items-center gap-1 truncate"><Phone className="w-3 h-3 shrink-0" />{contact.phone}</p>}
        {contact.email && <p className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{contact.email}</p>}
      </div>

      {(extraEntries.length > 0 || contact.raw_text) && (
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="mt-2 text-[11px] text-blue-500 hover:underline"
        >
          {showRaw ? '접기' : '자세히'}
        </button>
      )}
      {showRaw && (
        <div className="mt-1 space-y-1 text-[11px] text-gray-500">
          {extraEntries.map(([k, v]) => (
            <p key={k} className="truncate"><span className="text-gray-400">{k}:</span> {String(v)}</p>
          ))}
          {contact.raw_text && <pre className="whitespace-pre-wrap break-words">{contact.raw_text}</pre>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement `ContactsSection`**

Create `frontend/src/components/meeting/ContactsSection.tsx`:

```tsx
import { useEffect } from 'react'
import { Users } from 'lucide-react'
import { useContacts } from '../../hooks/useContacts'
import { createAuthenticatedConsumer } from '../../lib/actionCableAuth'
import { ContactCard } from './ContactCard'

interface ContactsSectionProps {
  meetingId: number
}

export function ContactsSection({ meetingId }: ContactsSectionProps) {
  const { contacts, remove, refetch } = useContacts(meetingId)

  // 명함 인식은 비동기(서버 Job) — 전용 채널 구독으로 contacts_updated 수신 시 refetch.
  // useTranscription 마운트 여부와 무관하게 동작하도록 독립 구독한다.
  useEffect(() => {
    const consumer = createAuthenticatedConsumer()
    const sub = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: { type?: string }) {
          if (data?.type === 'contacts_updated' || data?.type === 'card_extraction_failed') {
            refetch()
          }
        },
      },
    )
    return () => {
      sub.unsubscribe()
      consumer.disconnect()
    }
  }, [meetingId, refetch])

  if (contacts.length === 0) return null

  return (
    <div className="border-b bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700">
        <Users className="w-4 h-4" />
        참석자 (명함)
        <span className="text-xs text-gray-400">{contacts.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {contacts.map((c) => (
          <ContactCard key={c.id} contact={c} onDelete={remove} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the component test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meeting/ContactsSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Render it in MeetingPage**

In `frontend/src/pages/MeetingPage.tsx`, find the attachments render line (~408):

```tsx
{attachmentsVisible && <AttachmentSection meetingId={meetingId} />}
```

Add the import at the top (near the other `components/meeting` imports):

```tsx
import { ContactsSection } from '../components/meeting/ContactsSection'
```

And render the section right after the attachments line:

```tsx
{attachmentsVisible && <AttachmentSection meetingId={meetingId} />}
<ContactsSection meetingId={meetingId} />
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/meeting/ContactCard.tsx \
        frontend/src/components/meeting/ContactsSection.tsx \
        frontend/src/components/meeting/ContactsSection.test.tsx \
        frontend/src/pages/MeetingPage.tsx
git commit -m "feat(cards): ContactsSection panel + realtime refetch + render in MeetingPage"
```

---

## Task 9: `AddFileDialog` 명함 chip + `AttachmentSection` 명함 tab

**Files:**
- Modify: `frontend/src/components/meeting/AddFileDialog.tsx`
- Modify: `frontend/src/components/meeting/AttachmentSection.tsx`

- [ ] **Step 1: Add the 명함 category + image-only behavior in AddFileDialog**

In `frontend/src/components/meeting/AddFileDialog.tsx`, change the `CATEGORIES` const (line ~51):

```tsx
const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
]
```

to:

```tsx
const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
  { value: 'business_card', label: '명함' },
]

const IMAGE_ONLY_TYPES = '.png,.jpg,.jpeg,.webp'
```

Then make the file `accept` and hint depend on category. Replace the `<input ... accept={ACCEPTED_FILE_TYPES} ...>` line with:

```tsx
          <input
            id="attachment-file-input"
            type="file"
            accept={category === 'business_card' ? IMAGE_ONLY_TYPES : ACCEPTED_FILE_TYPES}
            multiple
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
            className="hidden"
          />
```

And replace the hint paragraph `<p className="text-xs text-gray-400 mt-1">PDF, DOC, ...</p>` with:

```tsx
          <p className="text-xs text-gray-400 mt-1">
            {category === 'business_card'
              ? '명함 이미지를 올리면 자동 인식되어 참석자로 등록됩니다 (PNG/JPG/WEBP)'
              : 'PDF, DOC, XLS, PPT, 이미지, ZIP, HWP 등'}
          </p>
```

> For the Tauri picker (`handleTauriFileSelect`), the existing extension filter already includes image types, so no change is required for v1.

Now add the **"인식 중" indicator + fallback refetch** to `AddFileDialog.tsx` (extraction is async; the panel updates via ActionCable, and this guarantees it even if the message is missed):

1. Add the import near the top:

```tsx
import { notifyContactsChanged } from '../../hooks/useContacts'
```

2. Add state next to the other `useState` calls (after `const [dragOver, setDragOver] = useState(false)`):

```tsx
  const [cardProcessing, setCardProcessing] = useState(false)
```

3. In `handleUpload`, declare a success flag next to `let anyError = false`:

```tsx
    let anyError = false
    let anyCardSuccess = false
```

   and inside the `try` block, right after the successful `createFileAttachment(...)` line, record card success:

```tsx
        await createFileAttachment(meetingId, category, files[i].file)
        if (category === 'business_card') anyCardSuccess = true
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status: 'done', progress: 100 } : f)))
```

4. Replace the tail of `handleUpload` (the `setUploading(false) … if (!anyError) onClose()` block) with:

```tsx
    setUploading(false)
    onUploaded() // 성공분은 목록에 반영
    if (anyCardSuccess) {
      // 명함 인식은 서버 비동기 — 패널은 ActionCable로 갱신되지만, 누락 대비 지연 refetch도 쏜다.
      setCardProcessing(true)
      ;[3000, 7000, 12000].forEach((ms) => setTimeout(() => notifyContactsChanged(meetingId), ms))
    }
    // 실패가 있거나 명함 인식 중이면 다이얼로그를 닫지 않는다(사용자가 상태를 보게).
    if (!anyError && !anyCardSuccess) onClose()
```

5. Render the indicator just above the bottom buttons (before `{/* 하단 버튼 */}`):

```tsx
        {cardProcessing && (
          <p className="mb-3 text-sm text-blue-600">
            명함 인식 중… 잠시 후 참석자(명함) 패널에 표시됩니다. 이 창은 닫아도 됩니다.
          </p>
        )}
```

- [ ] **Step 2: Add the 명함 tab to AttachmentSection (shows the preserved card images)**

In `frontend/src/components/meeting/AttachmentSection.tsx`, change the `CATEGORIES` const (line ~13):

```tsx
const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
]
```

to:

```tsx
const CATEGORIES: { value: AttachmentCategory; label: string }[] = [
  { value: 'agenda', label: '안건' },
  { value: 'reference', label: '참고자료' },
  { value: 'minutes', label: '첨부' },
  { value: 'business_card', label: '명함' },
]
```

And update `countByCategory` initial record (line ~26) to include the new key:

```tsx
    const counts: Record<AttachmentCategory, number> = { agenda: 0, reference: 0, minutes: 0, business_card: 0 }
```

- [ ] **Step 3: Build to verify types + no breakage**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes (no type errors from the new `'business_card'` union member) and `vite build` succeeds.

> Per project guidance (`feedback_full_compile_verify`): trust `vite build`, not incremental tsc. If the build flags any remaining exhaustive-`Record<AttachmentCategory, …>` or `switch` on category, fix those call sites the same way (add the `business_card` arm).

- [ ] **Step 4: Run the full frontend test suite (no regressions)**

Run: `cd frontend && npx vitest run`
Expected: all green (including the new contacts tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meeting/AddFileDialog.tsx \
        frontend/src/components/meeting/AttachmentSection.tsx
git commit -m "feat(cards): 명함 upload chip (image-only) + 명함 attachment tab"
```

---

## Task 10: End-to-end manual verification

**Files:** none (manual).

- [ ] **Step 1: Ensure a vision key is configured**

Confirm `ANTHROPIC_AUTH_TOKEN` is set for the running Rails server (and optionally `VISION_LLM_MODEL`). Without it, extraction fails gracefully (image preserved, `card_extraction_failed` broadcast).

- [ ] **Step 2: Restart backend so the new job/model/routes load**

Run: `./dev.sh down && ./dev.sh up` (or restart the `ddobak` tmux rails window). Confirm no PendingMigrationError.

- [ ] **Step 3: Upload a card and verify**

In a meeting detail page → open file upload → pick **명함** → upload a real business-card photo. Within a few seconds the **참석자 (명함)** panel should populate (name/company/title/contacts). Verify:
- The card image also appears under the attachments **명함** tab.
- `meeting.attendees` now contains the recognized name (open Edit meeting dialog).
- Editing/deleting a contact in the panel works.
- The AI 요약/회의록 prompt now includes the attendee (summarize and check).

- [ ] **Step 4: Verify failure path**

Temporarily unset `ANTHROPIC_AUTH_TOKEN`, upload a card → the image is still attached, no contact row is created, and no crash (check rails log for `[CardExtractionJob]`).

---

## Self-Review (completed during planning)

**Spec coverage:**
- Structured `meeting_contacts` table (all fields + extra + raw_text) → Task 1 ✓
- Attendees non-destructive sync → Task 1 (`append_attendee!`) + Task 3 ✓
- Dedicated server vision call, decoupled from per-user/CLI LLM → Task 2 ✓
- OCR-once persistence (no re-OCR) → Task 2/3 (results stored; reads use stored rows) ✓
- Async job on `business_card` upload, image preserved → Task 4 ✓
- contacts CRUD (index/update/destroy) + control authz → Task 5 ✓
- 명함 upload entry + image-only + 회의록 panel → Tasks 8, 9 ✓
- "명함 인식 중" indicator (spec §4.1) → Task 9 ✓
- Realtime `contacts_updated` / `card_extraction_failed` (channel verified) + delayed-refetch fallback → Tasks 7, 8, 9 ✓
- AI 요약엔 이름만(사용자 확정) — attendees 이름 동기화로 충족, 카드 상세는 패널/DB에만 ✓
- No `MeetingParticipant` / account creation → honored (untouched) ✓
- Error handling: vision-unavailable / bad-JSON / non-image → Tasks 2, 3, 9 ✓

**Type consistency:** `MeetingContact` field names match across migration → model → `contact_json` → frontend `MeetingContact` interface. `AttachmentCategory` union extended in one place (`api/attachments.ts`) and consumed by `AddFileDialog`/`AttachmentSection`. Job/service contract: service returns symbol-keyed hashes with keys `name, company, department, title, mobile, phone, fax, email, website, address, extra, raw_text`; job reads exactly those.

**Placeholder scan:** none — every step has concrete code/commands.

**Out of scope (per spec §7):** manual contact add form, global address book, PDF cards, multi-language tuning.
