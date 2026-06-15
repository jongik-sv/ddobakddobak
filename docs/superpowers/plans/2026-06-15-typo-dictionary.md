# 폴더별 오타사전 (Glossary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오타 교정 매핑을 폴더 계층 단위로 영속 저장하고, 파일 재STT 후 자동 gsub 재적용하여 "재STT해도 오타가 다시 나오지 않게" 한다.

**Architecture:** polymorphic `GlossaryEntry`(owner: Folder|Meeting) + `GlossaryResolver`(계층 cascade) + `GlossaryApplication`(literal/regex gsub, ReDoS 가드) + `MeetingGlossaryApplier`(표면 적용). 파일 STT 잡 훅에서 자동 재적용, `/feedback`은 적용 후 회의 사전에 자동 영속. 선결로 FoldersController IDOR 인가 버그 수정.

**Tech Stack:** Rails 8.1 / RSpec + FactoryBot / React + TypeScript / Vitest / ky.

**Spec:** `docs/superpowers/specs/2026-06-15-typo-dictionary-design.md`

---

## File Structure

생성:
- `backend/db/migrate/20260615000009_create_glossary_entries.rb`
- `backend/app/models/glossary_entry.rb`
- `backend/app/services/glossary_resolver.rb`
- `backend/app/services/glossary_application.rb`
- `backend/app/services/meeting_glossary_applier.rb`
- `backend/app/controllers/api/v1/glossary_entries_controller.rb`
- `backend/spec/models/glossary_entry_spec.rb`
- `backend/spec/models/folder_editable_spec.rb`
- `backend/spec/services/glossary_resolver_spec.rb`
- `backend/spec/services/glossary_application_spec.rb`
- `backend/spec/services/meeting_glossary_applier_spec.rb`
- `backend/spec/requests/api/v1/glossary_entries_spec.rb`
- `backend/spec/requests/api/v1/meetings_glossary_spec.rb`
- `frontend/src/api/glossary.ts`
- `frontend/src/hooks/useGlossary.ts`
- `frontend/src/components/meeting/GlossaryPanel.tsx`

수정:
- `backend/app/models/folder.rb` — `editable_by?`, `ancestor_records`, `has_many :glossary_entries`
- `backend/app/models/meeting.rb` — `has_many :glossary_entries`
- `backend/app/controllers/api/v1/folders_controller.rb` — 인가 가드
- `backend/app/controllers/api/v1/meetings_controller.rb` — `feedback` 리팩터+영속, `glossary`, `reapply_glossary`
- `backend/app/jobs/file_transcription_job.rb` — 자동 재적용 훅
- `backend/config/routes.rb` — glossary 라우트
- `backend/spec/requests/api/v1/folders_spec.rb` — IDOR 회귀
- `frontend/src/pages/MeetingPage.tsx` — GlossaryPanel 마운트

---

# Phase A — 보안 선결 (FoldersController IDOR)

## Task 1: `Folder#editable_by?` + `ancestor_records`

**Files:**
- Modify: `backend/app/models/folder.rb`
- Test: `backend/spec/models/folder_editable_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/models/folder_editable_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe Folder, "#editable_by? / #ancestor_records" do
  let(:owner)   { create(:user) }
  let(:other)   { create(:user) }
  let(:admin)   { create(:user, :admin) }
  let(:root)    { create(:folder) }
  let(:mid)     { create(:folder, parent: root) }
  let(:leaf)    { create(:folder, parent: mid) }

  describe "#editable_by?" do
    before { create(:meeting, creator: owner, folder_id: leaf.id) }

    it "admin은 항상 편집 가능" do
      expect(leaf.editable_by?(admin)).to be true
    end

    it "폴더 직속 회의 creator는 편집 가능" do
      expect(leaf.editable_by?(owner)).to be true
    end

    it "무관한 사용자는 편집 불가" do
      expect(leaf.editable_by?(other)).to be false
    end
  end

  describe "#ancestor_records" do
    it "가까운→먼 순서의 조상 레코드를 반환" do
      expect(leaf.ancestor_records.map(&:id)).to eq([mid.id, root.id])
    end

    it "루트 폴더는 빈 배열" do
      expect(root.ancestor_records).to eq([])
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/folder_editable_spec.rb`
Expected: FAIL — `undefined method 'editable_by?'`

- [ ] **Step 3: 구현**

`backend/app/models/folder.rb` — `ancestors` 메서드(현 L15-25) 바로 아래에 추가:
```ruby
  # admin 또는 이 폴더에 직속한 회의의 creator 면 편집 가능(폴더엔 소유 컬럼이 없음).
  def editable_by?(user)
    user.admin? || meetings.exists?(created_by_id: user.id)
  end

  # 가까운 → 먼 순서의 조상 Folder 레코드 (사이클 가드).
  def ancestor_records
    records = []
    current = parent
    seen = {}
    while current && !seen[current.id]
      seen[current.id] = true
      records << current
      current = current.parent
    end
    records
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/folder_editable_spec.rb`
Expected: PASS (5 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/folder.rb backend/spec/models/folder_editable_spec.rb
git commit -m "feat(folders): add editable_by? + ancestor_records helpers"
```

## Task 2: FoldersController 인가 (IDOR 회귀 수정)

**Files:**
- Modify: `backend/app/controllers/api/v1/folders_controller.rb`
- Test: `backend/spec/requests/api/v1/folders_spec.rb`

- [ ] **Step 1: 실패 테스트 추가**

`backend/spec/requests/api/v1/folders_spec.rb` 의 마지막 `describe` 뒤(L38 `end` 앞)에 추가:
```ruby
  describe "인가 (IDOR 방지)" do
    let!(:owned_meeting) { create(:meeting, creator: user, folder_id: folder.id) }

    it "무관한 사용자는 폴더 수정 불가 (403)" do
      login_as(other)
      patch "/api/v1/folders/#{folder.id}", params: { name: "해킹됨" }
      expect(response).to have_http_status(:forbidden)
      expect(folder.reload.name).not_to eq("해킹됨")
    end

    it "무관한 사용자는 폴더 삭제 불가 (403)" do
      login_as(other)
      delete "/api/v1/folders/#{folder.id}"
      expect(response).to have_http_status(:forbidden)
      expect(Folder.exists?(folder.id)).to be true
    end

    it "직속 회의 creator는 폴더 수정 가능 (200)" do
      login_as(user)
      patch "/api/v1/folders/#{folder.id}", params: { name: "내폴더" }
      expect(response).to have_http_status(:ok)
      expect(folder.reload.name).to eq("내폴더")
    end

    it "admin은 폴더 수정 가능 (200)" do
      login_as(admin)
      patch "/api/v1/folders/#{folder.id}", params: { name: "관리자수정" }
      expect(response).to have_http_status(:ok)
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/folders_spec.rb -e "IDOR"`
Expected: FAIL — 현재 가드 없어 403 대신 200 반환

- [ ] **Step 3: 구현**

`backend/app/controllers/api/v1/folders_controller.rb`:

L5 `before_action :set_folder, ...` 아래에 추가:
```ruby
      before_action :authorize_folder_edit!, only: %i[update destroy]
```

`#create`(L20-32)를 parent 편집권 검사 포함으로 교체:
```ruby
      def create
        if params[:parent_id].present?
          parent = Folder.find_by(id: params[:parent_id])
          return render json: { error: "상위 폴더가 없습니다" }, status: :not_found unless parent
          unless parent.editable_by?(current_user)
            return render json: { error: "상위 폴더에 생성할 권한이 없습니다" }, status: :forbidden
          end
        end

        folder = Folder.new(
          name: params[:name],
          parent_id: params[:parent_id],
          position: params[:position] || next_position(params[:parent_id])
        )

        if folder.save
          render json: { folder: folder_json(folder) }, status: :created
        else
          render json: { errors: folder.errors.full_messages }, status: :unprocessable_entity
        end
      end
```

`private` 섹션의 `set_folder` 아래에 추가:
```ruby
      def authorize_folder_edit!
        return if @folder.editable_by?(current_user)
        render json: { error: "폴더를 편집할 권한이 없습니다" }, status: :forbidden
      end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/folders_spec.rb`
Expected: PASS (전체 — 기존 카운트 스코프 + IDOR)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/folders_controller.rb backend/spec/requests/api/v1/folders_spec.rb
git commit -m "fix(folders): authorize update/destroy/create (close IDOR)"
```

---

# Phase B — 데이터 모델

## Task 3: 마이그레이션 + `GlossaryEntry` 모델

**Files:**
- Create: `backend/db/migrate/20260615000009_create_glossary_entries.rb`
- Create: `backend/app/models/glossary_entry.rb`
- Test: `backend/spec/models/glossary_entry_spec.rb`

- [ ] **Step 1: 마이그레이션 작성**

`backend/db/migrate/20260615000009_create_glossary_entries.rb`:
```ruby
class CreateGlossaryEntries < ActiveRecord::Migration[8.0]
  def change
    create_table :glossary_entries do |t|
      t.string  :owner_type, null: false
      t.bigint  :owner_id,   null: false
      t.string  :from_text,  null: false
      t.string  :to_text,    null: false
      t.string  :match_type, null: false, default: "literal"
      t.boolean :enabled,    null: false, default: true
      t.bigint  :created_by_id
      t.timestamps
    end

    add_index :glossary_entries, %i[owner_type owner_id]
    add_index :glossary_entries, %i[owner_type owner_id from_text match_type],
              unique: true, name: "idx_glossary_unique_from"
  end
end
```

- [ ] **Step 2: 마이그레이트**

Run: `cd backend && bundle exec rails db:migrate`
Expected: `create_table(:glossary_entries)` 성공, `db/schema.rb` version 2026_06_15_000009 갱신.

> ⚠️ dev 서버 가동 중이면 PendingMigrationError 회피 위해 마이그레이트 후 재시작 필요(메모 `feedback_rails_pending_migration_trap`).

- [ ] **Step 3: 실패 테스트 작성**

`backend/spec/models/glossary_entry_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe GlossaryEntry do
  let(:folder) { create(:folder) }

  it "유효한 literal 엔트리 저장" do
    e = folder.glossary_entries.build(from_text: "회진", to_text: "회의")
    expect(e).to be_valid
    expect(e.match_type).to eq("literal")
  end

  it "from_text 필수" do
    e = folder.glossary_entries.build(from_text: "", to_text: "회의")
    expect(e).not_to be_valid
  end

  it "literal 모드에서 from == to 면 무효" do
    e = folder.glossary_entries.build(from_text: "회의", to_text: "회의")
    expect(e).not_to be_valid
  end

  it "owner+from+match_type 중복 금지" do
    folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
    dup = folder.glossary_entries.build(from_text: "회진", to_text: "회담")
    expect(dup).not_to be_valid
  end

  it "from_text 200자 초과 무효" do
    e = folder.glossary_entries.build(from_text: "가" * 201, to_text: "x")
    expect(e).not_to be_valid
  end

  it "regex 모드: 잘못된 정규식은 무효" do
    e = folder.glossary_entries.build(from_text: "(unclosed", to_text: "x", match_type: "regex")
    expect(e).not_to be_valid
  end

  it "regex 모드: 올바른 정규식은 유효 (from==to 검사 생략)" do
    e = folder.glossary_entries.build(from_text: "이사(?!회)", to_text: "의사", match_type: "regex")
    expect(e).to be_valid
  end
end
```

- [ ] **Step 4: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/glossary_entry_spec.rb`
Expected: FAIL — `uninitialized constant GlossaryEntry`

- [ ] **Step 5: 모델 구현**

`backend/app/models/glossary_entry.rb`:
```ruby
class GlossaryEntry < ApplicationRecord
  MATCH_TYPES = %w[literal regex].freeze

  belongs_to :owner, polymorphic: true
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id, optional: true

  validates :from_text, presence: true, length: { maximum: 200 }
  validates :to_text, presence: true
  validates :match_type, inclusion: { in: MATCH_TYPES }
  validates :from_text, uniqueness: { scope: %i[owner_type owner_id match_type] }
  validate  :from_differs_from_to, if: -> { match_type == "literal" }
  validate  :regex_compiles, if: -> { match_type == "regex" }

  scope :active, -> { where(enabled: true) }

  private

  def from_differs_from_to
    errors.add(:to_text, "must differ from from_text") if from_text == to_text
  end

  def regex_compiles
    Regexp.new(from_text.to_s)
  rescue RegexpError => e
    errors.add(:from_text, "is not a valid regex: #{e.message}")
  end
end
```

- [ ] **Step 6: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/glossary_entry_spec.rb`
Expected: PASS (8 examples)

- [ ] **Step 7: 커밋**

```bash
git add backend/db/migrate/20260615000009_create_glossary_entries.rb backend/db/schema.rb backend/app/models/glossary_entry.rb backend/spec/models/glossary_entry_spec.rb
git commit -m "feat(glossary): add GlossaryEntry model + migration"
```

## Task 4: Folder / Meeting 연관

**Files:**
- Modify: `backend/app/models/folder.rb`, `backend/app/models/meeting.rb`

- [ ] **Step 1: 연관 추가**

`backend/app/models/folder.rb` — `has_many :meetings`(현 L5) 아래에 추가:
```ruby
  has_many :glossary_entries, as: :owner, dependent: :destroy
```

`backend/app/models/meeting.rb` — `belongs_to :folder, optional: true`(L4) 근처 연관 블록에 추가:
```ruby
  has_many :glossary_entries, as: :owner, dependent: :destroy
```

- [ ] **Step 2: 검증 (콘솔)**

Run: `cd backend && bundle exec rails runner 'f=Folder.create!(name:"t"); f.glossary_entries.create!(from_text:"a",to_text:"b"); puts f.glossary_entries.count; f.destroy; puts GlossaryEntry.where(owner:f).count'`
Expected: `1` 그리고 `0` (dependent: :destroy 동작).

- [ ] **Step 3: 커밋**

```bash
git add backend/app/models/folder.rb backend/app/models/meeting.rb
git commit -m "feat(glossary): wire has_many :glossary_entries on Folder/Meeting"
```

---

# Phase C — 코어 서비스

## Task 5: `GlossaryResolver` (계층 cascade)

**Files:**
- Create: `backend/app/services/glossary_resolver.rb`
- Test: `backend/spec/services/glossary_resolver_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/glossary_resolver_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe GlossaryResolver do
  let(:root) { create(:folder) }
  let(:sub)  { create(:folder, parent: root) }
  let(:meeting) { create(:meeting, folder_id: sub.id) }

  def entries_for(meeting)
    GlossaryResolver.for(meeting)
  end

  it "회의 > 폴더 > 조상 순으로 수집하고 구체적 레벨이 override" do
    root.glossary_entries.create!(from_text: "AA", to_text: "root")
    sub.glossary_entries.create!(from_text: "AA", to_text: "sub")     # override root
    meeting.glossary_entries.create!(from_text: "BB", to_text: "meet")

    result = entries_for(meeting)
    aa = result.find { |e| e[:from] == "AA" }
    expect(aa[:to]).to eq("sub")                                       # 더 구체적
    expect(result.map { |e| e[:from] }).to include("BB")
  end

  it "literal 은 from_text 길이 내림차순 정렬" do
    sub.glossary_entries.create!(from_text: "이사", to_text: "의사")
    sub.glossary_entries.create!(from_text: "이사회", to_text: "의사회")
    result = entries_for(meeting).select { |e| e[:match_type] == "literal" }
    expect(result.map { |e| e[:from] }).to eq(%w[이사회 이사])         # 긴 것 먼저
  end

  it "regex 엔트리는 literal 뒤에 온다" do
    sub.glossary_entries.create!(from_text: "x", to_text: "y")
    sub.glossary_entries.create!(from_text: "a.", to_text: "z", match_type: "regex")
    types = entries_for(meeting).map { |e| e[:match_type] }
    expect(types).to eq(%w[literal regex])
  end

  it "disabled 엔트리는 제외" do
    sub.glossary_entries.create!(from_text: "off", to_text: "x", enabled: false)
    expect(entries_for(meeting).map { |e| e[:from] }).not_to include("off")
  end

  it "폴더 없는 회의도 회의 엔트리만으로 동작" do
    m = create(:meeting, folder_id: nil)
    m.glossary_entries.create!(from_text: "z", to_text: "Z")
    expect(entries_for(m).map { |e| e[:from] }).to eq(["z"])
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/glossary_resolver_spec.rb`
Expected: FAIL — `uninitialized constant GlossaryResolver`

- [ ] **Step 3: 구현**

`backend/app/services/glossary_resolver.rb`:
```ruby
# meeting 에 적용할 교정 목록을 결정론적 순서로 반환.
# 구체성: 회의 > 현재 폴더 > 가까운 조상 > 먼 조상.
# 같은 [from_text, match_type] 은 더 구체적인 레벨이 override.
# 적용 순서: literal(길이 내림차순) 먼저, regex(id 순) 나중.
class GlossaryResolver
  def self.for(meeting)
    new(meeting).resolve
  end

  def initialize(meeting)
    @meeting = meeting
  end

  def resolve
    by_key = {}
    levels.each do |owner|
      owner.glossary_entries.active.order(:id).each do |e|
        key = [e.from_text, e.match_type]
        next if by_key.key?(key) # 더 구체적 레벨이 이미 점유
        next if e.match_type == "literal" && e.from_text == e.to_text
        by_key[key] = { from: e.from_text, to: e.to_text, match_type: e.match_type }
      end
    end

    entries  = by_key.values
    literals = entries.select { |e| e[:match_type] == "literal" }.sort_by { |e| -e[:from].length }
    regexes  = entries.select { |e| e[:match_type] == "regex" }
    literals + regexes
  end

  private

  def levels
    result = [@meeting]
    if @meeting.folder
      result << @meeting.folder
      result.concat(@meeting.folder.ancestor_records)
    end
    result
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/glossary_resolver_spec.rb`
Expected: PASS (5 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/glossary_resolver.rb backend/spec/services/glossary_resolver_spec.rb
git commit -m "feat(glossary): add GlossaryResolver cascade"
```

## Task 6: `GlossaryApplication` (literal/regex gsub + ReDoS 가드)

**Files:**
- Create: `backend/app/services/glossary_application.rb`
- Test: `backend/spec/services/glossary_application_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/glossary_application_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe GlossaryApplication do
  def lit(from, to) = { from: from, to: to, match_type: "literal" }
  def rex(from, to) = { from: from, to: to, match_type: "regex" }

  it "literal 치환" do
    expect(GlossaryApplication.apply("회진 시작", [lit("회진", "회의")])).to eq("회의 시작")
  end

  it "여러 엔트리 순차 적용" do
    out = GlossaryApplication.apply("a b", [lit("a", "x"), lit("b", "y")])
    expect(out).to eq("x y")
  end

  it "regex 치환 + 백레퍼런스" do
    out = GlossaryApplication.apply("2026년", [rex('(\d+)년', '\1 year')])
    expect(out).to eq("2026 year")
  end

  it "regex lookahead 로 부분치환 회피" do
    out = GlossaryApplication.apply("이사회 이사", [rex("이사(?!회)", "의사")])
    expect(out).to eq("이사회 의사")
  end

  it "빈 텍스트는 그대로" do
    expect(GlossaryApplication.apply("", [lit("a", "b")])).to eq("")
  end

  it "잘못된/타임아웃 정규식은 해당 엔트리만 스킵하고 텍스트 보존" do
    # timeout 즉시 유발용 — catastrophic backtracking 패턴
    evil = { from: "(a+)+$", to: "x", match_type: "regex" }
    input = "aaaaaaaaaaaaaaaaaaaaaaaaaaaab"
    stub_const("GlossaryApplication::REGEX_TIMEOUT", 0.01)
    expect(GlossaryApplication.apply(input, [evil])).to eq(input)
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/glossary_application_spec.rb`
Expected: FAIL — `uninitialized constant GlossaryApplication`

- [ ] **Step 3: 구현**

`backend/app/services/glossary_application.rb`:
```ruby
# 교정 엔트리 배열을 텍스트에 순차 적용한다.
# entry = { from:, to:, match_type: "literal"|"regex" }
# regex 는 사용자 입력 → 백그라운드 잡에서 무인 실행되므로 ReDoS 가드 필수:
#   per-pattern Regexp.timeout + 적용 중 타임아웃/컴파일 오류 시 해당 엔트리만 스킵.
class GlossaryApplication
  REGEX_TIMEOUT = 0.5 # seconds

  def self.apply(text, entries)
    return text if text.blank? || entries.blank?
    entries.reduce(text) { |acc, e| apply_one(acc, e) }
  end

  def self.apply_one(text, entry)
    if entry[:match_type] == "regex"
      re = Regexp.new(entry[:from].to_s, timeout: REGEX_TIMEOUT)
      text.gsub(re, entry[:to].to_s)
    else
      text.gsub(entry[:from].to_s, entry[:to].to_s)
    end
  rescue Regexp::TimeoutError, RegexpError => err
    Rails.logger.warn("[glossary] regex skip from=#{entry[:from].inspect} err=#{err.class}")
    text
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/glossary_application_spec.rb`
Expected: PASS (6 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/glossary_application.rb backend/spec/services/glossary_application_spec.rb
git commit -m "feat(glossary): add GlossaryApplication (literal/regex + ReDoS guard)"
```

## Task 7: `MeetingGlossaryApplier` (표면 적용)

**Files:**
- Create: `backend/app/services/meeting_glossary_applier.rb`
- Test: `backend/spec/services/meeting_glossary_applier_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/meeting_glossary_applier_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe MeetingGlossaryApplier do
  let(:meeting) { create(:meeting) }
  let(:entries) { [{ from: "회진", to: "회의", match_type: "literal" }] }

  before do
    create(:transcript, meeting: meeting, content: "회진 시작")
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 노트")
  end

  describe "#apply_transcripts!" do
    it "트랜스크립트만 교정하고 건수 반환" do
      count = MeetingGlossaryApplier.new(meeting, entries).apply_transcripts!
      expect(count).to eq(1)
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.notes_markdown).to eq("회진 노트") # 미변경
    end
  end

  describe "#apply_all!" do
    it "전 표면(요약+트랜스크립트) 교정" do
      MeetingGlossaryApplier.new(meeting, entries).apply_all!
      expect(meeting.transcripts.first.content).to eq("회의 시작")
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 노트")
    end

    it "빈 엔트리면 아무것도 안 함" do
      expect { MeetingGlossaryApplier.new(meeting, []).apply_all! }.not_to(change { meeting.transcripts.first.content })
    end
  end
end
```

> 참고: 트랜스크립트/요약은 팩토리(`create(:transcript, ...)`, `create(:summary, ...)`)로 생성한다 — Transcript 는 `speaker_label`/`ended_at_ms`, Summary 는 `generated_at` 도 필수라 raw `create!` 는 검증 실패한다.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/meeting_glossary_applier_spec.rb`
Expected: FAIL — `uninitialized constant MeetingGlossaryApplier`

- [ ] **Step 3: 구현**

`backend/app/services/meeting_glossary_applier.rb`:
```ruby
# 교정 엔트리를 회의의 텍스트 표면에 적용한다.
# - apply_transcripts! : 트랜스크립트만 (전사 직후 훅용 — 이후 요약은 교정본에서 생성)
# - apply_all!         : 요약 4컬럼 + action_items + decisions + blocks + transcripts (수동 재적용/feedback)
# 둘 다 트랜스크립트 변경 건수를 반환한다.
class MeetingGlossaryApplier
  SUMMARY_COLS = %i[notes_markdown key_points decisions discussion_details].freeze

  def initialize(meeting, entries)
    @meeting = meeting
    @entries = entries
  end

  def apply_transcripts!
    correct_records!(@meeting.transcripts, :content)
  end

  def apply_all!
    return 0 if @entries.blank?

    @meeting.summaries.find_each do |summary|
      attrs = {}
      SUMMARY_COLS.each do |col|
        original = summary[col]
        next if original.blank?
        corrected = GlossaryApplication.apply(original, @entries)
        attrs[col] = corrected if corrected != original
      end
      if attrs.any?
        attrs[:generated_at] = Time.current
        summary.update!(attrs)
      end
    end

    correct_records!(@meeting.action_items, :content)
    correct_records!(@meeting.decisions, :content)
    correct_records!(@meeting.blocks, :content)
    correct_records!(@meeting.transcripts, :content)
  end

  private

  def correct_records!(relation, column)
    return 0 if @entries.blank?
    changed = 0
    relation.find_each do |record|
      original = record[column]
      next if original.blank?
      corrected = GlossaryApplication.apply(original, @entries)
      if corrected != original
        record.update!(column => corrected)
        changed += 1
      end
    end
    changed
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/meeting_glossary_applier_spec.rb`
Expected: PASS (3 examples)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/meeting_glossary_applier.rb backend/spec/services/meeting_glossary_applier_spec.rb
git commit -m "feat(glossary): add MeetingGlossaryApplier (surface application)"
```

---

# Phase D — 배선 (잡 훅 · /feedback · API)

## Task 8: 파일 STT 잡 자동 재적용 훅

**Files:**
- Modify: `backend/app/jobs/file_transcription_job.rb`
- Test: `backend/spec/jobs/file_transcription_glossary_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/jobs/file_transcription_glossary_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "FileTranscriptionJob glossary hook" do
  it "store_transcripts 직후 resolver 교정을 트랜스크립트에 적용한다" do
    folder  = create(:folder)
    meeting = create(:meeting, folder_id: folder.id, status: "transcribing")
    folder.glossary_entries.create!(from_text: "회진", to_text: "회의")

    job = FileTranscriptionJob.new
    # store_transcripts 가 만든 상태를 흉내: 트랜스크립트를 직접 만들고 훅 메서드만 호출
    create(:transcript, meeting: meeting, content: "회진 결과")

    job.send(:apply_glossary_corrections, meeting)

    expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
  end
end
```

> 전체 `perform` 통합은 sidecar/ffmpeg 의존이라 단위 격리 — 새 private 메서드 `apply_glossary_corrections` 를 직접 호출해 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/file_transcription_glossary_spec.rb`
Expected: FAIL — `undefined method 'apply_glossary_corrections'`

- [ ] **Step 3: 구현**

`backend/app/jobs/file_transcription_job.rb`:

L43 `apply_speaker_names(meeting)` 와 L44 `broadcast_progress(channel, 93, ...)` 사이에 호출 추가:
```ruby
    apply_speaker_names(meeting)
    apply_glossary_corrections(meeting)
    broadcast_progress(channel, 93, "트랜스크립트 저장 완료")
```

`private`(L85) 아래에 메서드 추가:
```ruby
  # 폴더/회의 오타사전을 트랜스크립트에 자동 재적용(요약 생성 전). 실패해도 전사는 진행.
  def apply_glossary_corrections(meeting)
    entries = GlossaryResolver.for(meeting)
    return if entries.empty?
    count = MeetingGlossaryApplier.new(meeting, entries).apply_transcripts!
    Rails.logger.info("[FileTranscriptionJob] glossary applied meeting=#{meeting.id} changed=#{count}")
  rescue => e
    Rails.logger.warn("[FileTranscriptionJob] glossary skip meeting=#{meeting.id} err=#{e.class}: #{e.message}")
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/file_transcription_glossary_spec.rb`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/file_transcription_job.rb backend/spec/jobs/file_transcription_glossary_spec.rb
git commit -m "feat(glossary): auto re-apply on file STT (post store_transcripts)"
```

## Task 9: `/feedback` 리팩터 + 회의 사전 자동 영속 (D2=A)

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb`
- Test: `backend/spec/requests/api/v1/meetings_glossary_spec.rb` (feedback 영속 부분)

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/requests/api/v1/meetings_glossary_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1 meeting glossary", type: :request do
  let(:user)    { create(:user) }
  let(:folder)  { create(:folder) }
  let!(:meeting) { create(:meeting, creator: user, folder_id: folder.id, status: "completed") }

  before do
    login_as(user)
    create(:transcript, meeting: meeting, content: "회진 결과")
  end

  describe "POST /feedback — 적용 후 회의 사전에 영속" do
    it "교정이 트랜스크립트에 적용되고 회의 사전에 저장된다" do
      post "/api/v1/meetings/#{meeting.id}/feedback",
           params: { corrections: [{ from: "회진", to: "회의" }] }
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
      entry = meeting.glossary_entries.find_by(from_text: "회진")
      expect(entry).to be_present
      expect(entry.to_text).to eq("회의")
    end

    it "같은 from 재교정 시 to_text upsert" do
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [{ from: "회진", to: "회의" }] }
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [{ from: "회진", to: "회담" }] }
      expect(meeting.glossary_entries.where(from_text: "회진").count).to eq(1)
      expect(meeting.glossary_entries.find_by(from_text: "회진").to_text).to eq("회담")
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_glossary_spec.rb`
Expected: FAIL — 사전 엔트리 미생성

- [ ] **Step 3: 구현 — `feedback` 액션 교체**

`backend/app/controllers/api/v1/meetings_controller.rb` 의 `feedback`(L338-385)을 다음으로 교체:
```ruby
      def feedback
        corrections = params[:corrections]
        return render json: { error: "Corrections are required" }, status: :unprocessable_entity if corrections.blank?

        corrections = corrections.map { |c| { from: c[:from].to_s, to: c[:to].to_s } }
                                 .reject { |c| c[:from].blank? }
        return render json: { error: "No valid corrections provided" }, status: :unprocessable_entity if corrections.empty?

        before_active_notes = @meeting.current_notes_markdown.to_s

        entries = corrections.map { |c| { from: c[:from], to: c[:to], match_type: "literal" } }
        corrected_count = MeetingGlossaryApplier.new(@meeting, entries).apply_all!

        # D2=A: 적용한 교정을 회의 사전에 자동 영속(upsert). best-effort.
        persist_corrections_to_meeting_glossary(corrections)

        corrected_notes = @meeting.reload.current_notes_markdown.to_s
        if corrected_notes != before_active_notes
          @meeting.update!(last_user_edit_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)
          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end
```

`private` 섹션에서 기존 `apply_term_corrections`(L538-542) 와 `correct_records!`(L545-557) 를 삭제하고(아래 Step 4에서 미사용 확인), `persist_corrections_to_meeting_glossary` 추가:
```ruby
      def persist_corrections_to_meeting_glossary(corrections)
        corrections.each do |c|
          next if c[:from] == c[:to]
          entry = @meeting.glossary_entries.find_or_initialize_by(from_text: c[:from], match_type: "literal")
          entry.to_text = c[:to]
          entry.enabled = true
          entry.created_by_id ||= current_user.id
          entry.save # 검증 실패는 조용히 스킵(영속화는 부가 기능)
        end
      end
```

- [ ] **Step 4: 미사용 헬퍼 제거 확인**

Run: `cd backend && grep -rn "apply_term_corrections\|correct_records!" app/`
Expected: 매치 없음(모두 MeetingGlossaryApplier 로 이전됨). 매치가 남으면 해당 호출처도 처리 후 제거.

- [ ] **Step 5: 통과 확인 (영속 + 회귀)**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_glossary_spec.rb`
Expected: PASS (2 examples)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_glossary_spec.rb
git commit -m "refactor(feedback): use MeetingGlossaryApplier + persist corrections to meeting glossary"
```

## Task 10: `glossary` 뷰 + `reapply_glossary` 엔드포인트

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb`, `backend/config/routes.rb`
- Test: `backend/spec/requests/api/v1/meetings_glossary_spec.rb` (추가)

- [ ] **Step 1: 라우트 추가**

`backend/config/routes.rb` — meetings `member do` 블록(L38-65)의 `post :feedback`(L49) 아래에 추가:
```ruby
          get  :glossary
          post :reapply_glossary
          resources :glossary_entries, only: %i[create], controller: "glossary_entries"
```

- [ ] **Step 2: 실패 테스트 추가**

`spec/requests/api/v1/meetings_glossary_spec.rb` 에 추가:
```ruby
  describe "GET /glossary — 3단 뷰" do
    it "ancestors/folder/meeting 엔트리 + resolved 반환" do
      parent = create(:folder)
      folder.update!(parent_id: parent.id)
      parent.glossary_entries.create!(from_text: "AA", to_text: "aa")
      folder.glossary_entries.create!(from_text: "BB", to_text: "bb")
      meeting.glossary_entries.create!(from_text: "CC", to_text: "cc")

      get "/api/v1/meetings/#{meeting.id}/glossary"
      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["meeting"]["entries"].map { |e| e["from_text"] }).to include("CC")
      expect(body["folder"]["entries"].map { |e| e["from_text"] }).to include("BB")
      expect(body["ancestors"].first["entries"].map { |e| e["from_text"] }).to include("AA")
      expect(body["resolved"].map { |e| e["from"] }).to include("AA", "BB", "CC")
    end
  end

  describe "POST /reapply_glossary — 전 표면 수동 재적용" do
    it "resolver 교정을 전 표면에 적용" do
      folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 노트")

      post "/api/v1/meetings/#{meeting.id}/reapply_glossary"
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 노트")
    end
  end
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_glossary_spec.rb -e "glossary 뷰"`
Expected: FAIL — 액션 미구현

- [ ] **Step 4: 구현 — 액션 + 직렬화 헬퍼**

`backend/app/controllers/api/v1/meetings_controller.rb`:

L11 `before_action :authorize_meeting_control!, only: %i[... feedback]` 의 배열에 `reapply_glossary` 추가:
```ruby
      before_action :authorize_meeting_control!, only: %i[update start stop reopen pause resume reset_content summarize update_notes regenerate_stt regenerate_notes re_diarize feedback reapply_glossary]
```

`feedback` 액션 아래(public)에 추가:
```ruby
      def glossary
        folder = @meeting.folder
        render json: {
          meeting: { entries: @meeting.glossary_entries.order(:id).map { |e| glossary_entry_json(e) } },
          folder: folder && {
            folder: { id: folder.id, name: folder.name },
            entries: folder.glossary_entries.order(:id).map { |e| glossary_entry_json(e) }
          },
          ancestors: (folder ? folder.ancestor_records : []).map do |f|
            { folder: { id: f.id, name: f.name },
              entries: f.glossary_entries.order(:id).map { |e| glossary_entry_json(e) } }
          end,
          resolved: GlossaryResolver.for(@meeting)
        }
      end

      def reapply_glossary
        entries = GlossaryResolver.for(@meeting)
        before_active_notes = @meeting.current_notes_markdown.to_s
        corrected_count = MeetingGlossaryApplier.new(@meeting, entries).apply_all!

        corrected_notes = @meeting.reload.current_notes_markdown.to_s
        if corrected_notes != before_active_notes
          @meeting.update!(last_user_edit_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)
          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end
```

`private` 섹션에 직렬화 헬퍼 추가:
```ruby
      def glossary_entry_json(entry)
        {
          id: entry.id,
          from_text: entry.from_text,
          to_text: entry.to_text,
          match_type: entry.match_type,
          enabled: entry.enabled,
          owner_type: entry.owner_type,
          owner_id: entry.owner_id
        }
      end
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_glossary_spec.rb`
Expected: PASS (전체)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/config/routes.rb backend/spec/requests/api/v1/meetings_glossary_spec.rb
git commit -m "feat(glossary): add meeting glossary view + reapply endpoint"
```

## Task 11: `GlossaryEntriesController` (CRUD + 인가)

**Files:**
- Create: `backend/app/controllers/api/v1/glossary_entries_controller.rb`
- Modify: `backend/config/routes.rb` (folders 중첩 + 최상위 update/destroy)
- Test: `backend/spec/requests/api/v1/glossary_entries_spec.rb`

- [ ] **Step 1: 라우트 추가**

`backend/config/routes.rb`:

folders 라우트(L100)를 중첩 포함으로 교체:
```ruby
      resources :folders, only: %i[index create update destroy] do
        resources :glossary_entries, only: %i[create], controller: "glossary_entries"
      end
      resources :glossary_entries, only: %i[update destroy]
```

(meetings 중첩 create 는 Task 10 에서 이미 추가됨.)

- [ ] **Step 2: 실패 테스트 작성**

`backend/spec/requests/api/v1/glossary_entries_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::GlossaryEntries", type: :request do
  let(:owner)  { create(:user) }
  let(:other)  { create(:user) }
  let(:folder) { create(:folder) }
  let!(:meeting) { create(:meeting, creator: owner, folder_id: folder.id) }

  describe "POST /folders/:id/glossary_entries" do
    it "직속 회의 creator 는 폴더 엔트리 생성 가능" do
      login_as(owner)
      post "/api/v1/folders/#{folder.id}/glossary_entries",
           params: { from_text: "회진", to_text: "회의" }
      expect(response).to have_http_status(:created)
      expect(folder.glossary_entries.count).to eq(1)
    end

    it "무관한 사용자는 폴더 엔트리 생성 불가 (403)" do
      login_as(other)
      post "/api/v1/folders/#{folder.id}/glossary_entries",
           params: { from_text: "회진", to_text: "회의" }
      expect(response).to have_http_status(:forbidden)
      expect(folder.glossary_entries.count).to eq(0)
    end
  end

  describe "POST /meetings/:id/glossary_entries" do
    it "회의 소유자는 회의 엔트리 생성 가능" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/glossary_entries",
           params: { from_text: "x", to_text: "y", match_type: "regex" }
      expect(response).to have_http_status(:created)
      expect(meeting.glossary_entries.first.match_type).to eq("regex")
    end

    it "잘못된 정규식은 422" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/glossary_entries",
           params: { from_text: "(open", to_text: "y", match_type: "regex" }
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "PATCH/DELETE /glossary_entries/:id" do
    let!(:entry) { folder.glossary_entries.create!(from_text: "a", to_text: "b") }

    it "권한자는 수정" do
      login_as(owner)
      patch "/api/v1/glossary_entries/#{entry.id}", params: { to_text: "c" }
      expect(response).to have_http_status(:ok)
      expect(entry.reload.to_text).to eq("c")
    end

    it "무권한자는 수정 불가 (403)" do
      login_as(other)
      patch "/api/v1/glossary_entries/#{entry.id}", params: { to_text: "c" }
      expect(response).to have_http_status(:forbidden)
    end

    it "권한자는 삭제" do
      login_as(owner)
      delete "/api/v1/glossary_entries/#{entry.id}"
      expect(response).to have_http_status(:no_content)
      expect(GlossaryEntry.exists?(entry.id)).to be false
    end
  end
end
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/glossary_entries_spec.rb`
Expected: FAIL — 컨트롤러 미존재

- [ ] **Step 4: 컨트롤러 구현**

`backend/app/controllers/api/v1/glossary_entries_controller.rb`:
```ruby
module Api
  module V1
    class GlossaryEntriesController < ApplicationController
      before_action :authenticate_user!

      def create
        owner = resolve_owner
        return render json: { error: "Not found" }, status: :not_found unless owner
        return unless authorize_owner_edit!(owner)

        entry = owner.glossary_entries.build(entry_params.merge(created_by_id: current_user.id))
        if entry.save
          render json: { entry: serialize(entry) }, status: :created
        else
          render json: { errors: entry.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        entry = GlossaryEntry.find(params[:id])
        return unless authorize_owner_edit!(entry.owner)

        if entry.update(entry_params)
          render json: { entry: serialize(entry) }
        else
          render json: { errors: entry.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      def destroy
        entry = GlossaryEntry.find(params[:id])
        return unless authorize_owner_edit!(entry.owner)
        entry.destroy
        head :no_content
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      private

      def resolve_owner
        if params[:meeting_id]
          Meeting.find_by(id: params[:meeting_id])
        elsif params[:folder_id]
          Folder.find_by(id: params[:folder_id])
        end
      end

      # 인가 통과면 true, 아니면 403 렌더 후 false.
      def authorize_owner_edit!(owner)
        ok = case owner
             when Meeting then meeting_controllable?(owner)
             when Folder  then owner.editable_by?(current_user)
             else false
             end
        return true if ok
        render json: { error: "사전을 편집할 권한이 없습니다" }, status: :forbidden
        false
      end

      def meeting_controllable?(meeting)
        return true if current_user.respond_to?(:admin?) && current_user.admin?
        return true if meeting.owner?(current_user)
        meeting.host_participant&.user_id == current_user.id
      end

      def entry_params
        permitted = {}
        permitted[:from_text]  = params[:from_text] if params.key?(:from_text)
        permitted[:to_text]    = params[:to_text] if params.key?(:to_text)
        permitted[:match_type] = params[:match_type] if params.key?(:match_type)
        permitted[:enabled]    = ActiveModel::Type::Boolean.new.cast(params[:enabled]) if params.key?(:enabled)
        permitted
      end

      def serialize(entry)
        {
          id: entry.id,
          from_text: entry.from_text,
          to_text: entry.to_text,
          match_type: entry.match_type,
          enabled: entry.enabled,
          owner_type: entry.owner_type,
          owner_id: entry.owner_id
        }
      end
    end
  end
end
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/glossary_entries_spec.rb`
Expected: PASS (8 examples)

- [ ] **Step 6: 백엔드 전체 회귀**

Run: `cd backend && bundle exec rspec`
Expected: 전체 PASS (신규 + 기존).

- [ ] **Step 7: 커밋**

```bash
git add backend/app/controllers/api/v1/glossary_entries_controller.rb backend/config/routes.rb backend/spec/requests/api/v1/glossary_entries_spec.rb
git commit -m "feat(glossary): GlossaryEntriesController CRUD with per-owner authorization"
```

---

# Phase E — 프론트엔드

## Task 12: `api/glossary.ts`

**Files:**
- Create: `frontend/src/api/glossary.ts`

- [ ] **Step 1: API 모듈 작성**

`frontend/src/api/glossary.ts`:
```ts
import apiClient from './client'

export type GlossaryMatchType = 'literal' | 'regex'

export interface GlossaryEntry {
  id: number
  from_text: string
  to_text: string
  match_type: GlossaryMatchType
  enabled: boolean
  owner_type: 'Meeting' | 'Folder'
  owner_id: number
}

export interface GlossaryLevel {
  folder: { id: number; name: string }
  entries: GlossaryEntry[]
}

export interface GlossaryView {
  meeting: { entries: GlossaryEntry[] }
  folder: GlossaryLevel | null
  ancestors: GlossaryLevel[]
  resolved: { from: string; to: string; match_type: GlossaryMatchType }[]
}

export type GlossaryEntryInput = {
  from_text: string
  to_text: string
  match_type?: GlossaryMatchType
  enabled?: boolean
}

export async function getGlossary(meetingId: number): Promise<GlossaryView> {
  return apiClient.get(`meetings/${meetingId}/glossary`).json()
}

export async function createMeetingGlossaryEntry(meetingId: number, data: GlossaryEntryInput): Promise<{ entry: GlossaryEntry }> {
  return apiClient.post(`meetings/${meetingId}/glossary_entries`, { json: data }).json()
}

export async function createFolderGlossaryEntry(folderId: number, data: GlossaryEntryInput): Promise<{ entry: GlossaryEntry }> {
  return apiClient.post(`folders/${folderId}/glossary_entries`, { json: data }).json()
}

export async function updateGlossaryEntry(id: number, data: Partial<GlossaryEntryInput>): Promise<{ entry: GlossaryEntry }> {
  return apiClient.patch(`glossary_entries/${id}`, { json: data }).json()
}

export async function deleteGlossaryEntry(id: number): Promise<void> {
  await apiClient.delete(`glossary_entries/${id}`)
}

export async function reapplyGlossary(meetingId: number): Promise<{ notes_markdown: string; corrected_transcripts: number }> {
  return apiClient.post(`meetings/${meetingId}/reapply_glossary`, { timeout: 60000 }).json()
}
```

- [ ] **Step 2: 타입체크**

Run: `cd frontend && npx tsc -b`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/api/glossary.ts
git commit -m "feat(glossary): frontend api module"
```

## Task 13: `useGlossary` 훅

**Files:**
- Create: `frontend/src/hooks/useGlossary.ts`
- Test: `frontend/src/hooks/useGlossary.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/hooks/useGlossary.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGlossary } from './useGlossary'

vi.mock('../api/glossary', () => ({
  getGlossary: vi.fn(async () => ({
    meeting: { entries: [{ id: 1, from_text: 'a', to_text: 'b', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 }] },
    folder: null,
    ancestors: [],
    resolved: [{ from: 'a', to: 'b', match_type: 'literal' }],
  })),
  createMeetingGlossaryEntry: vi.fn(async () => ({ entry: { id: 2, from_text: 'c', to_text: 'd', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 } })),
  deleteGlossaryEntry: vi.fn(async () => {}),
  reapplyGlossary: vi.fn(async () => ({ notes_markdown: '', corrected_transcripts: 3 })),
}))

describe('useGlossary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('마운트 시 사전 뷰를 로드한다', async () => {
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    expect(result.current.view?.meeting.entries).toHaveLength(1)
  })

  it('reapply 호출 후 재조회', async () => {
    const api = await import('../api/glossary')
    const { result } = renderHook(() => useGlossary(1))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    await act(async () => { await result.current.reapply() })
    expect(api.reapplyGlossary).toHaveBeenCalledWith(1)
    expect(api.getGlossary).toHaveBeenCalledTimes(2) // 초기 + reapply 후
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/hooks/useGlossary.test.ts`
Expected: FAIL — `useGlossary` 미존재.

- [ ] **Step 3: 훅 구현**

`frontend/src/hooks/useGlossary.ts`:
```ts
import { useState, useEffect, useCallback } from 'react'
import {
  getGlossary, createMeetingGlossaryEntry, createFolderGlossaryEntry,
  updateGlossaryEntry, deleteGlossaryEntry, reapplyGlossary,
} from '../api/glossary'
import type { GlossaryView, GlossaryEntryInput } from '../api/glossary'

export function useGlossary(meetingId: number) {
  const [view, setView] = useState<GlossaryView | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setView(await getGlossary(meetingId))
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  useEffect(() => { load() }, [load])

  const addMeetingEntry = useCallback(async (data: GlossaryEntryInput) => {
    await createMeetingGlossaryEntry(meetingId, data)
    await load()
  }, [meetingId, load])

  const addFolderEntry = useCallback(async (folderId: number, data: GlossaryEntryInput) => {
    await createFolderGlossaryEntry(folderId, data)
    await load()
  }, [load])

  const editEntry = useCallback(async (id: number, data: Partial<GlossaryEntryInput>) => {
    await updateGlossaryEntry(id, data)
    await load()
  }, [load])

  const removeEntry = useCallback(async (id: number) => {
    await deleteGlossaryEntry(id)
    await load()
  }, [load])

  const reapply = useCallback(async () => {
    setStatus('재적용 중...')
    try {
      const r = await reapplyGlossary(meetingId)
      setStatus(`완료 (트랜스크립트 ${r.corrected_transcripts}건 수정)`)
      await load()
      setTimeout(() => setStatus(''), 3000)
    } catch {
      setStatus('재적용 실패')
      setTimeout(() => setStatus(''), 3000)
    }
  }, [meetingId, load])

  return { view, loading, status, reload: load, addMeetingEntry, addFolderEntry, editEntry, removeEntry, reapply }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/hooks/useGlossary.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/hooks/useGlossary.ts frontend/src/hooks/useGlossary.test.ts
git commit -m "feat(glossary): useGlossary hook"
```

## Task 14: `GlossaryPanel` 컴포넌트 + MeetingPage 마운트

**Files:**
- Create: `frontend/src/components/meeting/GlossaryPanel.tsx`
- Modify: `frontend/src/pages/MeetingPage.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`frontend/src/components/meeting/GlossaryPanel.tsx`:
```tsx
import { useState } from 'react'
import { useGlossary } from '../../hooks/useGlossary'
import type { GlossaryEntry, GlossaryLevel, GlossaryEntryInput } from '../../api/glossary'

/** 폴더별 오타사전 패널 — 상위폴더들 → 현재폴더 → 현재회의 3단 테이블 (회의 상세 하단) */
export function GlossaryPanel({ meetingId }: { meetingId: number }) {
  const { view, status, addMeetingEntry, addFolderEntry, editEntry, removeEntry, reapply } = useGlossary(meetingId)

  if (!view) return null

  return (
    <div className="border-t bg-white px-6 py-3 shrink-0">
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-500 select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
          오타 사전
          {status && <span className="text-xs font-normal text-blue-500 ml-2">{status}</span>}
        </summary>

        <div className="mt-2 flex flex-col gap-4 max-w-2xl">
          {view.ancestors.map((lvl) => (
            <GlossaryLevelTable
              key={`a-${lvl.folder.id}`}
              title={`상위폴더: ${lvl.folder.name}`}
              level={lvl}
              warnMeetings
              onAdd={(d) => addFolderEntry(lvl.folder.id, d)}
              onEdit={editEntry}
              onRemove={removeEntry}
            />
          ))}

          {view.folder && (
            <GlossaryLevelTable
              title={`현재 폴더: ${view.folder.folder.name}`}
              level={view.folder}
              warnMeetings
              onAdd={(d) => addFolderEntry(view.folder!.folder.id, d)}
              onEdit={editEntry}
              onRemove={removeEntry}
            />
          )}

          <GlossaryLevelTable
            title="현재 회의"
            level={{ folder: { id: 0, name: '' }, entries: view.meeting.entries }}
            onAdd={(d) => addMeetingEntry(d)}
            onEdit={editEntry}
            onRemove={removeEntry}
          />

          <button
            onClick={() => reapply()}
            className="self-end px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            사전 재적용
          </button>
        </div>
      </details>
    </div>
  )
}

function GlossaryLevelTable({
  title, level, warnMeetings, onAdd, onEdit, onRemove,
}: {
  title: string
  level: GlossaryLevel
  warnMeetings?: boolean
  onAdd: (d: GlossaryEntryInput) => void
  onEdit: (id: number, d: Partial<GlossaryEntryInput>) => void
  onRemove: (id: number) => void
}) {
  const [draft, setDraft] = useState<GlossaryEntryInput>({ from_text: '', to_text: '', match_type: 'literal' })

  const submit = () => {
    if (!draft.from_text.trim() || !draft.to_text.trim()) return
    onAdd(draft)
    setDraft({ from_text: '', to_text: '', match_type: 'literal' })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold text-gray-600">{title}</div>
      {warnMeetings && level.entries.length > 0 && (
        <div className="text-[11px] text-amber-600">이 폴더의 사전은 하위 모든 회의에 영향을 줍니다.</div>
      )}
      {level.entries.map((e: GlossaryEntry) => (
        <div key={e.id} className="flex items-center gap-1 text-sm">
          <span className="flex-1 min-w-0 truncate">{e.from_text}</span>
          <span className="text-gray-400 text-xs">&rarr;</span>
          <span className="flex-1 min-w-0 truncate">{e.to_text}</span>
          <span className="text-[10px] text-gray-400">{e.match_type === 'regex' ? '정규식' : ''}</span>
          <label className="text-[11px] flex items-center gap-1">
            <input type="checkbox" checked={e.enabled} onChange={(ev) => onEdit(e.id, { enabled: ev.target.checked })} />
            사용
          </label>
          <button onClick={() => onRemove(e.id)} className="w-6 h-6 text-gray-400 hover:text-red-500" title="삭제">&times;</button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text" value={draft.from_text} placeholder="잘못된 용어"
          onChange={(e) => setDraft({ ...draft, from_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="text-gray-400 text-xs">&rarr;</span>
        <input
          type="text" value={draft.to_text} placeholder="올바른 용어"
          onChange={(e) => setDraft({ ...draft, to_text: e.target.value })}
          className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <select
          value={draft.match_type}
          onChange={(e) => setDraft({ ...draft, match_type: e.target.value as 'literal' | 'regex' })}
          className="text-xs rounded-md border border-gray-300 px-1 py-1"
        >
          <option value="literal">리터럴</option>
          <option value="regex">정규식</option>
        </select>
        <button onClick={submit} className="text-xs text-blue-500 hover:text-blue-700 shrink-0">추가</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: MeetingPage 마운트**

`frontend/src/pages/MeetingPage.tsx`:

상단 import 에 `TermCorrectionDetails` import(L31 근처) 아래 추가:
```tsx
import { GlossaryPanel } from '../components/meeting/GlossaryPanel'
```

`TermCorrectionDetails` 블록(L449-460) 바로 아래에 추가:
```tsx
      {/* 오타 사전 섹션 */}
      {meeting?.status === 'completed' && meeting?.id && (
        <GlossaryPanel meetingId={meeting.id} />
      )}
```

- [ ] **Step 3: 빌드 + 타입체크**

Run: `cd frontend && npx tsc -b && npx vite build`
Expected: 빌드 성공, 타입 에러 없음.

- [ ] **Step 4: 프론트 테스트 회귀**

Run: `cd frontend && npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/meeting/GlossaryPanel.tsx frontend/src/pages/MeetingPage.tsx
git commit -m "feat(glossary): GlossaryPanel 3-tier table + mount in MeetingPage"
```

## Task 15 (부차, 시간 여유 시): 폴더 kebab "오타 사전" 다이얼로그

> Phase E Task 14 까지로 idea.md 스펙 §3(3단 테이블) 충족. 본 Task 는 사이드바에서 폴더 사전을
> 회의 없이 직접 관리하는 편의 기능 — MVP 아님. 별도 진행 가능.

**Files:**
- Create: `frontend/src/components/folder/GlossaryDialog.tsx`
- Modify: `frontend/src/components/folder/FolderTree.tsx` (kebab 메뉴에 "오타 사전" 항목)

- [ ] **Step 1:** `CreateFolderDialog.tsx` 패턴을 따라 `GlossaryDialog.tsx` 작성 — `getGlossary`/`createFolderGlossaryEntry` 대신 폴더 직접 조회용 API가 필요하면 `GET /folders/:id/glossary_entries`(only: [:index]) 라우트+액션을 추가하거나, 폴더 엔트리만 다루므로 `createFolderGlossaryEntry`/`updateGlossaryEntry`/`deleteGlossaryEntry` 로 구성.
- [ ] **Step 2:** `FolderTree.tsx` kebab 메뉴(현 "이름 변경"/"하위 폴더"/"공유"/"삭제")에 "오타 사전" 항목 추가 → 다이얼로그 오픈.
- [ ] **Step 3:** `npx tsc -b && npx vite build` 통과.
- [ ] **Step 4:** 커밋 `feat(glossary): folder kebab glossary dialog`.

---

# 최종 검증 (구현 완료 후)

- [ ] `cd backend && bundle exec rspec` 전체 PASS
- [ ] `cd backend && bundle exec rubocop`(있으면) 통과
- [ ] `cd frontend && npx tsc -b && npx vite build && npx vitest run` 전체 PASS
- [ ] **기기 E2E 수동 검증** (자동화 불가):
  1. 회의에서 "회진"→"회의" 오타수정 → 사전 패널에 자동 등록됨(D2=A) 확인
  2. `regenerate_stt` 재전사 → "회진" 다시 안 나옴 확인
  3. 폴더 사전 등록 → 하위 다른 회의 "사전 재적용" → 적용 확인
  4. 정규식 엔트리(`이사(?!회)`→`의사`) → "이사회" 보존·"이사" 치환 확인
  5. 무관한 사용자 계정(SERVER_MODE)으로 남의 폴더 수정 시도 → 403 확인 (IDOR)

---

## Self-Review 메모

- 스펙 커버리지: §2 모델(T3) · §3 resolver(T5) · §4 적용 3지점(T7·T8·T9·T10) · §5 범위(T8 훅만, 실시간 미배선) · §6 보안 IDOR(T1·T2)+권한(T11) · §7 API(T10·T11) · §8 UI(T12·T13·T14) · §9 테스트(각 Task) · §10 D1~D3(T6 regex/ReDoS, T9 영속, T8 범위). 전 항목 매핑됨.
- 타입 일관성: `match_type` 문자열 'literal'|'regex' 백/프론트 일치. `glossary_entry_json`/`serialize` 동일 키. resolver 반환 `{from,to,match_type}` ↔ GlossaryApplication 입력 동일.
- 픽스처: 트랜스크립트/요약은 팩토리 사용(필수 컬럼 speaker_label/ended_at_ms/generated_at 자동 채움). 확인 완료.
