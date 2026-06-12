# Transcript speaker_name 컬럼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화자 rename("화자 1" → "앨리스") 시 표시 이름이 트랜스크립트 배지·검색·markdown 내보내기에 보이게 한다. `speaker_label`(불변 ID)과 `speaker_name`(nullable 표시 이름)을 분리 유지.

**Architecture:** 이름의 source of truth는 sidecar SpeakerDB(names 맵). `transcripts.speaker_name`은 비정규화 사본 — rename/reset/STT 재생성 시 `update_all`로 동기화. 프론트는 `speaker_name ?? speaker_label` fallback 렌더 + rename 성공 시 zustand store in-place 갱신.

**Tech Stack:** Rails 8.1 + SQLite + RSpec (backend/), React + TS + zustand + vitest (frontend/)

**Spec:** `docs/superpowers/specs/2026-06-12-speaker-name-column-design.md`

---

## 전역 주의사항 (모든 태스크 공통)

1. **마이그레이션 트랩**: 마이그레이션 파일 생성 후 즉시 `cd backend && bin/rails db:migrate` 실행. 러닝 dev 서버가 pending migration 상태면 전 요청 500.
2. **git add는 변경 파일만 명시. `git add -A` / `git add .` 절대 금지.** 다음 미커밋 타작업 파일 절대 건드리지 말 것: `backend/app/services/llm_service.rb`, `frontend/src/hooks/useMicCapture.ts`, `frontend/src-tauri/gen/**`, `idea.md`, `4교시백업.md`
3. `llm_service.rb`(AI 요약 통합)는 Out of Scope — 수정 금지.
4. 검색 화자 필터는 **exact match(`= ?`) 유지**. LIKE로 바꾸지 말 것.
5. `name == id`는 "이름 미설정" 의미 — speaker_name에 복사하지 않음(null 유지).
6. FTS(`fts_table :transcripts_fts, columns: %i[content speaker_label]`)에 speaker_name **추가하지 말 것** (out of scope).
7. 프론트 pdf/docx exporter(`lib/pdfExporter.ts`, `lib/docxExporter.ts`)와 BlockNote `TranscriptBlock.tsx`는 out of scope — 수정 금지.
8. 검증 명령: `cd backend && bundle exec rspec` / `cd frontend && npx vitest run` + `npx vite build` (`npm run build`의 `tsc -b`는 기존 무관 에러 9개 — vite build만 통과하면 됨)
9. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

---

### Task 1: 마이그레이션 + 직렬화 (speaker_name 컬럼 노출)

**Files:**
- Create: `backend/db/migrate/<timestamp>_add_speaker_name_to_transcripts.rb` (rails generate로 생성)
- Modify: `backend/db/schema.rb` (migrate가 자동 갱신)
- Modify: `backend/app/controllers/concerns/transcript_serializable.rb` (`transcript_json`)
- Modify: `backend/app/controllers/concerns/meeting_serializable.rb:56-67` (`serialize_transcripts`)
- Create: `backend/spec/models/transcript_speaker_name_spec.rb`
- Modify: `backend/spec/requests/api/v1/transcripts_spec.rb` ("각 트랜스크립트에 필수 필드 포함" it 블록 근처에 추가)
- Modify: `backend/spec/requests/api/v1/meetings_spec.rb` (GET show describe 안에 추가)

- [ ] **Step 1: 마이그레이션 생성 + 즉시 migrate** (⚠️ 한 번에 실행 — 파일만 만들고 멈추면 dev 서버 500)

```bash
cd /Users/jji/project/ddobakddobak/backend && bin/rails generate migration AddSpeakerNameToTranscripts speaker_name:string && bin/rails db:migrate
```

생성된 마이그레이션이 아래와 같은지 확인 (null 허용, default 없음 — `null: false` 붙이지 말 것. `Migration[8.x]` 버전 숫자는 생성기 출력 그대로 둠):

```ruby
class AddSpeakerNameToTranscripts < ActiveRecord::Migration[8.1]
  def change
    add_column :transcripts, :speaker_name, :string
  end
end
```

Expected: `db/schema.rb`의 transcripts 테이블에 `t.string "speaker_name"` 추가됨, version 갱신.

- [ ] **Step 2: 실패하는 테스트 작성 (직렬화)**

`backend/spec/models/transcript_speaker_name_spec.rb` 생성:

```ruby
require "rails_helper"

RSpec.describe Transcript, type: :model do
  describe "speaker_name 컬럼" do
    it "nullable string 컬럼이 존재한다" do
      expect(Transcript.column_names).to include("speaker_name")
      t = create(:transcript, speaker_name: nil)
      expect(t).to be_valid
    end

    it "speaker_name을 저장/조회할 수 있다" do
      t = create(:transcript, speaker_name: "앨리스")
      expect(t.reload.speaker_name).to eq("앨리스")
    end
  end
end
```

`backend/spec/requests/api/v1/transcripts_spec.rb`의 "각 트랜스크립트에 필수 필드 포함" it 블록 바로 아래에 추가:

```ruby
it "speaker_name 필드를 포함한다 (미설정 시 null)" do
  get "/api/v1/meetings/#{meeting.id}/transcripts"

  json = response.parsed_body
  transcript = json["transcripts"].first
  expect(transcript).to have_key("speaker_name")
  expect(transcript["speaker_name"]).to be_nil
end
```

`backend/spec/requests/api/v1/meetings_spec.rb`의 `describe "GET /api/v1/meetings/:id"` > `context "when authenticated as team member"` 안에 추가:

```ruby
it "transcripts에 speaker_name을 포함한다" do
  create(:transcript, meeting: meeting, sequence_number: 1, speaker_name: "앨리스")

  get "/api/v1/meetings/#{meeting.id}"

  json = response.parsed_body
  expect(json["meeting"]["transcripts"].first["speaker_name"]).to eq("앨리스")
end
```

- [ ] **Step 3: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/models/transcript_speaker_name_spec.rb spec/requests/api/v1/transcripts_spec.rb spec/requests/api/v1/meetings_spec.rb
```

Expected: 모델 스펙 2건 PASS(컬럼은 이미 존재), 직렬화 스펙 2건 FAIL (`have_key("speaker_name")` 불일치).

- [ ] **Step 4: 직렬화 구현**

`backend/app/controllers/concerns/transcript_serializable.rb` — `transcript_json`에 한 줄 추가:

```ruby
def transcript_json(t)
  {
    id: t.id,
    content: t.content,
    speaker_label: t.speaker_label,
    speaker_name: t.speaker_name,
    started_at_ms: t.started_at_ms,
    ended_at_ms: t.ended_at_ms,
    sequence_number: t.sequence_number,
    applied_to_minutes: t.applied_to_minutes
  }
end
```

`backend/app/controllers/concerns/meeting_serializable.rb` — `serialize_transcripts`에 한 줄 추가:

```ruby
def serialize_transcripts(meeting)
  meeting.transcripts.order(:started_at_ms).map do |t|
    {
      id: t.id,
      content: t.content,
      speaker_label: t.speaker_label,
      speaker_name: t.speaker_name,
      sequence_number: t.sequence_number,
      started_at_ms: t.started_at_ms,
      ended_at_ms: t.ended_at_ms
    }
  end
end
```

- [ ] **Step 5: 통과 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/models/transcript_speaker_name_spec.rb spec/requests/api/v1/transcripts_spec.rb spec/requests/api/v1/meetings_spec.rb
```

Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add backend/db/migrate/*_add_speaker_name_to_transcripts.rb backend/db/schema.rb backend/app/controllers/concerns/transcript_serializable.rb backend/app/controllers/concerns/meeting_serializable.rb backend/spec/models/transcript_speaker_name_spec.rb backend/spec/requests/api/v1/transcripts_spec.rb backend/spec/requests/api/v1/meetings_spec.rb && git commit -m "feat(speakers): transcripts에 speaker_name 컬럼 추가 + 직렬화 노출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: SpeakersController rename/reset → speaker_name 동기화

**Files:**
- Modify: `backend/app/controllers/api/v1/speakers_controller.rb` (`#update`, `#destroy_all`)
- Modify: `backend/spec/requests/api/v1/speakers_spec.rb`

**현재 코드** (`speakers_controller.rb`):

```ruby
def update
  speaker_id = params[:id]
  name = params.require(:name)
  result = SidecarClient.new.rename_speaker(speaker_id, name, @meeting.id)
  render json: result
rescue SidecarClient::SidecarError => e
  render json: { error: e.message }, status: :not_found
rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
  render json: { error: e.message }, status: :service_unavailable
end

def destroy_all
  SidecarClient.new.reset_speakers(@meeting.id)
  render json: { ok: true }
rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
  render json: { ok: true }
end
```

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/api/v1/speakers_spec.rb`에 describe 추가 (기존 권한 테스트는 그대로 둠):

```ruby
describe "speaker_name 비정규화" do
  let(:meeting) { create(:meeting, creator: user) }
  let(:sidecar) { instance_double(SidecarClient) }

  before do
    allow(SidecarClient).to receive(:new).and_return(sidecar)
  end

  describe "PATCH /api/v1/speakers/:id (rename)" do
    let!(:t1) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_00", sequence_number: 1) }
    let!(:t2) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_01", sequence_number: 2) }

    it "sidecar 성공 시 해당 라벨 트랜스크립트만 speaker_name 갱신" do
      allow(sidecar).to receive(:rename_speaker)
        .with("SPEAKER_00", "앨리스", meeting.id)
        .and_return({ "id" => "SPEAKER_00", "name" => "앨리스" })

      patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "앨리스" }

      expect(response).to have_http_status(:ok)
      expect(t1.reload.speaker_name).to eq("앨리스")
      expect(t2.reload.speaker_name).to be_nil
    end

    it "이름을 라벨과 동일하게 지정하면 speaker_name은 null (이름 해제)" do
      t1.update!(speaker_name: "앨리스")
      allow(sidecar).to receive(:rename_speaker)
        .with("SPEAKER_00", "SPEAKER_00", meeting.id)
        .and_return({ "id" => "SPEAKER_00", "name" => "SPEAKER_00" })

      patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "SPEAKER_00" }

      expect(response).to have_http_status(:ok)
      expect(t1.reload.speaker_name).to be_nil
    end

    it "sidecar 실패(SidecarError) 시 speaker_name을 갱신하지 않는다" do
      allow(sidecar).to receive(:rename_speaker)
        .and_raise(SidecarClient::SidecarError, "404 not found")

      patch "/api/v1/speakers/SPEAKER_00", params: { meeting_id: meeting.id, name: "앨리스" }

      expect(response).to have_http_status(:not_found)
      expect(t1.reload.speaker_name).to be_nil
    end
  end

  describe "DELETE /api/v1/speakers/destroy_all (reset)" do
    let!(:t1) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_00", speaker_name: "앨리스", sequence_number: 1) }
    let!(:t2) { create(:transcript, meeting: meeting, speaker_label: "SPEAKER_01", speaker_name: "밥", sequence_number: 2) }

    it "sidecar 성공 시 모든 speaker_name을 null로 초기화" do
      allow(sidecar).to receive(:reset_speakers).with(meeting.id).and_return({ "ok" => true })

      delete "/api/v1/speakers/destroy_all", params: { meeting_id: meeting.id }

      expect(response).to have_http_status(:ok)
      expect(t1.reload.speaker_name).to be_nil
      expect(t2.reload.speaker_name).to be_nil
    end

    it "sidecar 연결 실패 시 speaker_name을 유지한다 (sidecar DB가 리셋되지 않았으므로)" do
      allow(sidecar).to receive(:reset_speakers)
        .and_raise(SidecarClient::ConnectionError, "down")

      delete "/api/v1/speakers/destroy_all", params: { meeting_id: meeting.id }

      expect(response).to have_http_status(:ok)
      expect(t1.reload.speaker_name).to eq("앨리스")
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/requests/api/v1/speakers_spec.rb
```

Expected: 신규 테스트 중 "갱신" 계열 FAIL (speaker_name nil 그대로), sidecar 실패 계열은 PASS일 수 있음. 기존 권한 테스트 2건 PASS 유지.

- [ ] **Step 3: 구현**

`backend/app/controllers/api/v1/speakers_controller.rb`의 `update`/`destroy_all`을 다음으로 교체 (sidecar 호출 **성공 후**에만 update_all — rescue 경로에서 갱신 금지):

```ruby
def update
  speaker_id = params[:id]
  name = params.require(:name)
  result = SidecarClient.new.rename_speaker(speaker_id, name, @meeting.id)
  # name == id 는 sidecar 규약상 "이름 미설정" — 비정규화 사본도 null 유지
  @meeting.transcripts.where(speaker_label: speaker_id)
          .update_all(speaker_name: name == speaker_id ? nil : name)
  render json: result
rescue SidecarClient::SidecarError => e
  render json: { error: e.message }, status: :not_found
rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
  render json: { error: e.message }, status: :service_unavailable
end

def destroy_all
  SidecarClient.new.reset_speakers(@meeting.id)
  @meeting.transcripts.update_all(speaker_name: nil)
  render json: { ok: true }
rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
  render json: { ok: true }
end
```

- [ ] **Step 4: 통과 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/requests/api/v1/speakers_spec.rb
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add backend/app/controllers/api/v1/speakers_controller.rb backend/spec/requests/api/v1/speakers_spec.rb && git commit -m "feat(speakers): rename/reset 시 transcripts.speaker_name 동기화

sidecar 호출 성공 후에만 update_all. name == id는 이름 해제로 간주해 null.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: FileTranscriptionJob — STT 재생성 후 이름 재적용

**Files:**
- Modify: `backend/app/jobs/file_transcription_job.rb` (`perform` 3번 단계 직후 + private 메서드 추가)
- Modify: `backend/spec/jobs/file_transcription_job_spec.rb`

**배경:** SpeakerDB names 맵은 "화자 N" 키로 보존됨 — 재인식 후 `GET /speakers`로 names를 받아 `name != id`인 항목만 재적용하면 기존 이름 유지. `SidecarClient#get_speakers(meeting_id)`는 `{ "speakers" => [{ "id" => ..., "name" => ... }] }` 반환.

- [ ] **Step 1: 기존 before 블록에 get_speakers 스텁 추가** (없으면 기존 테스트가 instance_double 미스텁 에러로 깨짐)

`backend/spec/jobs/file_transcription_job_spec.rb`의 `before do ... end` 블록 안, `allow(sidecar).to receive(:transcribe_file)...` 줄 아래에 추가:

```ruby
allow(sidecar).to receive(:get_speakers).and_return({ "speakers" => [] })
```

- [ ] **Step 2: 실패하는 테스트 작성**

같은 파일에 it 블록 2개 추가:

```ruby
it "재생성 후 SpeakerDB 이름(name != id)만 speaker_name으로 재적용한다" do
  allow(sidecar).to receive(:transcribe_file).and_return({
    "segments" => [
      { "text" => "안녕하세요", "speaker_label" => "화자 1", "started_at_ms" => 0, "ended_at_ms" => 1000 },
      { "text" => "반갑습니다", "speaker_label" => "화자 2", "started_at_ms" => 1000, "ended_at_ms" => 2000 }
    ]
  })
  allow(sidecar).to receive(:get_speakers).with(meeting.id).and_return({
    "speakers" => [
      { "id" => "화자 1", "name" => "앨리스" },
      { "id" => "화자 2", "name" => "화자 2" }
    ]
  })

  described_class.perform_now(meeting.id)

  expect(meeting.transcripts.find_by(speaker_label: "화자 1").speaker_name).to eq("앨리스")
  expect(meeting.transcripts.find_by(speaker_label: "화자 2").speaker_name).to be_nil
end

it "get_speakers 실패 시에도 잡은 정상 완료한다 (이름 미적용)" do
  allow(sidecar).to receive(:transcribe_file).and_return({
    "segments" => [
      { "text" => "안녕하세요", "speaker_label" => "화자 1", "started_at_ms" => 0, "ended_at_ms" => 1000 }
    ]
  })
  allow(sidecar).to receive(:get_speakers)
    .and_raise(SidecarClient::ConnectionError, "down")

  described_class.perform_now(meeting.id)

  expect(meeting.reload.status).to eq("completed")
  expect(meeting.transcripts.first.speaker_name).to be_nil
end
```

- [ ] **Step 3: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/jobs/file_transcription_job_spec.rb
```

Expected: 신규 첫 테스트 FAIL (speaker_name nil). 두 번째는 현재 get_speakers를 호출하지 않으므로 PASS일 수 있음. 기존 테스트 PASS 유지.

- [ ] **Step 4: 구현**

`backend/app/jobs/file_transcription_job.rb` — `perform`의 3번 단계 직후에 호출 추가:

```ruby
    # 3. Transcript 레코드 일괄 생성
    store_transcripts(meeting, result["segments"])
    apply_speaker_names(meeting)
    broadcast_progress(channel, 80, "트랜스크립트 저장 완료")
```

private 영역(`store_transcripts` 아래)에 메서드 추가:

```ruby
  # SpeakerDB names 맵을 비정규화 사본(speaker_name)으로 재적용한다.
  # name == id 는 "이름 미설정" — 복사하지 않는다. 실패해도 잡은 계속 진행.
  def apply_speaker_names(meeting)
    speakers = SidecarClient.new.get_speakers(meeting.id)["speakers"]
    return if speakers.blank?

    speakers.each do |sp|
      next if sp["name"].blank? || sp["name"] == sp["id"]
      meeting.transcripts.where(speaker_label: sp["id"]).update_all(speaker_name: sp["name"])
    end
  rescue SidecarClient::SidecarError, SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
    Rails.logger.warn "[FileTranscriptionJob] meeting=#{meeting.id} speaker_name 재적용 실패: #{e.message}"
  end
```

- [ ] **Step 5: 통과 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/jobs/file_transcription_job_spec.rb
```

Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add backend/app/jobs/file_transcription_job.rb backend/spec/jobs/file_transcription_job_spec.rb && git commit -m "feat(speakers): STT 재생성 후 SpeakerDB 이름을 speaker_name에 재적용

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SearchService — 이름으로 화자 필터 + 결과 speaker 표시 이름

**Files:**
- Modify: `backend/app/services/search_service.rb:51-86` (`search_transcripts`)
- Modify: `backend/spec/requests/api/v1/search_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/api/v1/search_spec.rb`의 `context "트랜스크립트 검색"` 안에 it 블록 추가:

```ruby
it "화자 이름으로 화자 필터가 매칭된다 (exact match)" do
  create(:transcript, meeting: meeting, content: "프로젝트 마감 임박",
         speaker_label: "SPEAKER_02", speaker_name: "앨리스")

  get "/api/v1/search", params: { q: "프로젝트", speaker: "앨리스" }

  expect(response).to have_http_status(:ok)
  json = response.parsed_body
  expect(json["total"]).to eq(1)
  expect(json["results"].first["speaker"]).to eq("앨리스")
end

it "라벨 필터도 계속 동작하고 결과 speaker는 표시 이름을 반환한다" do
  create(:transcript, meeting: meeting, content: "프로젝트 회고 진행",
         speaker_label: "SPEAKER_03", speaker_name: "밥")

  get "/api/v1/search", params: { q: "프로젝트", speaker: "SPEAKER_03" }

  json = response.parsed_body
  expect(json["total"]).to eq(1)
  expect(json["results"].first["speaker"]).to eq("밥")
end

it "이름이 없으면 결과 speaker는 라벨을 반환한다" do
  get "/api/v1/search", params: { q: "프로젝트", speaker: "SPEAKER_00" }

  json = response.parsed_body
  expect(json["total"]).to eq(1)
  expect(json["results"].first["speaker"]).to eq("SPEAKER_00")
end
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/requests/api/v1/search_spec.rb
```

Expected: "이름으로 매칭" FAIL (total 0), "라벨 필터" FAIL (speaker가 라벨 반환), "이름 없으면 라벨" PASS.

- [ ] **Step 3: 구현**

`backend/app/services/search_service.rb`의 `search_transcripts`에서 3곳 수정 (exact match `= ?` 유지 — LIKE 금지):

```ruby
    speaker_condition = if @filters[:speaker].present?
      "AND (t.speaker_label = ? OR t.speaker_name = ?)"
    else
      ""
    end

    sql = <<~SQL
      SELECT t.id, t.meeting_id, t.speaker_label, t.speaker_name, t.created_at,
             m.title AS meeting_title,
             snippet(transcripts_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      JOIN meetings m ON m.id = t.meeting_id
      WHERE transcripts_fts MATCH ?
        AND t.meeting_id IN (#{placeholders})
        #{speaker_condition}
      ORDER BY rank
    SQL

    binds = [ fts_q ] + accessible_meeting_ids
    binds += [ @filters[:speaker], @filters[:speaker] ] if @filters[:speaker].present?
```

결과 매핑의 speaker 필드:

```ruby
        speaker: row["speaker_name"].presence || row["speaker_label"],
```

- [ ] **Step 4: 통과 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/requests/api/v1/search_spec.rb
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add backend/app/services/search_service.rb backend/spec/requests/api/v1/search_spec.rb && git commit -m "feat(search): 화자 필터에 speaker_name 매칭 + 결과 speaker 표시 이름

exact match 유지 (LIKE 아님 — ESCAPE 불필요)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MarkdownExporter — 표시 이름으로 내보내기

**Files:**
- Modify: `backend/app/services/markdown_exporter.rb:97-115` (`render_transcript`)
- Modify: `backend/spec/services/markdown_exporter_spec.rb` (`describe "원본 텍스트 섹션"` 안)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/services/markdown_exporter_spec.rb`의 `describe "원본 텍스트 섹션"` 안에 추가:

```ruby
it "speaker_name이 있으면 라벨 대신 이름을 출력한다" do
  create(:transcript, meeting: meeting, speaker_label: "화자3", speaker_name: "앨리스",
         content: "이름 테스트입니다.", started_at_ms: 120_000, sequence_number: 3)

  result = exporter.call
  expect(result).to include("**앨리스**")
  expect(result).not_to include("**화자3**")
end
```

(기존 테스트 "화자 레이블을 굵은 글씨로 출력한다"가 name 없는 경우의 라벨 fallback을 커버)

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/services/markdown_exporter_spec.rb
```

Expected: 신규 테스트 FAIL (`**화자3**` 출력됨).

- [ ] **Step 3: 구현**

`backend/app/services/markdown_exporter.rb`의 `render_transcript` 내 한 줄 교체:

```ruby
      lines << "**#{t.speaker_name.presence || t.speaker_label}** (#{format_timestamp_ms(t.started_at_ms)})"
```

- [ ] **Step 4: 통과 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/services/markdown_exporter_spec.rb
```

Expected: 전부 PASS.

- [ ] **Step 5: backend 전체 회귀 확인**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec
```

Expected: 전부 PASS (기존 544+ 스펙 회귀 없음).

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add backend/app/services/markdown_exporter.rb backend/spec/services/markdown_exporter_spec.rb && git commit -m "feat(export): markdown 내보내기에 화자 표시 이름 사용

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 프론트 타입·매퍼·스토어 액션

**Files:**
- Modify: `frontend/src/api/meetings.ts:352-360` (`Transcript` 인터페이스)
- Modify: `frontend/src/channels/transcription.ts:16-26` (`TranscriptFinalData`)
- Modify: `frontend/src/lib/transcriptMapper.ts`
- Modify: `frontend/src/pages/MeetingPage.tsx:245-255` (loadFinals 인라인 매핑)
- Modify: `frontend/src/stores/transcriptStore.ts` (액션 2개 추가)
- Create: `frontend/src/lib/transcriptMapper.test.ts`
- Modify: `frontend/src/stores/transcriptStore.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/transcriptMapper.test.ts` 생성:

```ts
import { describe, it, expect } from 'vitest'
import { mapTranscriptsToFinals } from './transcriptMapper'

describe('mapTranscriptsToFinals', () => {
  it('speaker_name을 보존한다 (없으면 null)', () => {
    const finals = mapTranscriptsToFinals([
      {
        id: 1,
        speaker_label: '화자 1',
        speaker_name: '앨리스',
        content: '안녕하세요',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
      },
      {
        id: 2,
        speaker_label: '화자 2',
        content: '반갑습니다',
        started_at_ms: 1000,
        ended_at_ms: 2000,
        sequence_number: 2,
      },
    ])

    expect(finals[0].speaker_name).toBe('앨리스')
    expect(finals[1].speaker_name).toBeNull()
  })
})
```

`frontend/src/stores/transcriptStore.test.ts` 끝에 describe 추가:

```ts
describe('speaker_name 갱신', () => {
  const base = {
    content: '발화',
    started_at_ms: 0,
    ended_at_ms: 1000,
    sequence_number: 1,
    applied: false,
  }

  beforeEach(() => {
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().loadFinals([
      { ...base, id: 1, speaker_label: '화자 1' },
      { ...base, id: 2, speaker_label: '화자 2', started_at_ms: 1000, sequence_number: 2 },
    ])
  })

  it('setSpeakerName: 해당 라벨 finals만 speaker_name 갱신', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')

    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 1)?.speaker_name).toBe('앨리스')
    expect(finals.find((f) => f.id === 2)?.speaker_name).toBeUndefined()
  })

  it('setSpeakerName(label, null): 이름 해제', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    useTranscriptStore.getState().setSpeakerName('화자 1', null)

    expect(useTranscriptStore.getState().finals.find((f) => f.id === 1)?.speaker_name).toBeNull()
  })

  it('clearSpeakerNames: 모든 finals의 speaker_name 제거', () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    useTranscriptStore.getState().setSpeakerName('화자 2', '밥')
    useTranscriptStore.getState().clearSpeakerNames()

    for (const f of useTranscriptStore.getState().finals) {
      expect(f.speaker_name ?? null).toBeNull()
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run src/lib/transcriptMapper.test.ts src/stores/transcriptStore.test.ts
```

Expected: FAIL (speaker_name 타입 없음 → TS 에러 또는 setSpeakerName undefined).

- [ ] **Step 3: 타입 + 매퍼 + 스토어 구현**

`frontend/src/api/meetings.ts` — `Transcript` 인터페이스에 추가:

```ts
export interface Transcript {
  id: number
  speaker_label: string
  speaker_name?: string | null
  content: string
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  applied_to_minutes?: boolean
}
```

`frontend/src/channels/transcription.ts` — `TranscriptFinalData`에 추가:

```ts
export type TranscriptFinalData = {
  id: number
  content: string
  speaker_label: string
  speaker_name?: string | null
  started_at_ms: number
  ended_at_ms: number
  sequence_number: number
  applied: boolean
  created_at?: string
  audio_source?: 'mic' | 'system'
}
```

`frontend/src/lib/transcriptMapper.ts`:

```ts
export function mapTranscriptsToFinals(transcripts: Transcript[]): TranscriptFinalData[] {
  return transcripts.map((t) => ({
    id: t.id,
    content: t.content,
    speaker_label: t.speaker_label,
    speaker_name: t.speaker_name ?? null,
    started_at_ms: t.started_at_ms,
    ended_at_ms: t.ended_at_ms,
    sequence_number: t.sequence_number,
    applied: t.applied_to_minutes ?? false,
  }))
}
```

`frontend/src/pages/MeetingPage.tsx` 241-255행의 인라인 loadFinals 매핑에 한 줄 추가:

```ts
      loadFinals(
        data.map((t) => ({
          id: t.id,
          content: t.content,
          speaker_label: t.speaker_label,
          speaker_name: t.speaker_name ?? null,
          started_at_ms: t.started_at_ms,
          ended_at_ms: t.ended_at_ms,
          sequence_number: t.sequence_number,
          applied: t.applied_to_minutes ?? true,
        })),
      )
```

`frontend/src/stores/transcriptStore.ts` — 인터페이스에 액션 시그니처 추가:

```ts
  setSpeakerName: (speakerLabel: string, name: string | null) => void
  clearSpeakerNames: () => void
```

구현 추가 (`updateFinal` 아래):

```ts
  setSpeakerName: (speakerLabel, name) =>
    set((state) => ({
      finals: state.finals.map((f) =>
        f.speaker_label === speakerLabel ? { ...f, speaker_name: name } : f
      ),
    })),

  clearSpeakerNames: () =>
    set((state) => ({
      finals: state.finals.map((f) =>
        f.speaker_name != null ? { ...f, speaker_name: null } : f
      ),
    })),
```

- [ ] **Step 4: 통과 확인 + 빌드**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run src/lib/transcriptMapper.test.ts src/stores/transcriptStore.test.ts && npx vite build
```

Expected: 테스트 PASS, vite build 성공.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add frontend/src/api/meetings.ts frontend/src/channels/transcription.ts frontend/src/lib/transcriptMapper.ts frontend/src/lib/transcriptMapper.test.ts frontend/src/pages/MeetingPage.tsx frontend/src/stores/transcriptStore.ts frontend/src/stores/transcriptStore.test.ts && git commit -m "feat(speakers): 프론트 Transcript/finals에 speaker_name + 스토어 갱신 액션

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 배지 렌더 — speaker_name ?? speaker_label

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerLabel.tsx`
- Modify: `frontend/src/components/meeting/SpeakerLabel.test.tsx`
- Modify: `frontend/src/components/meeting/FullRecord.tsx:93`
- Modify: `frontend/src/components/meeting/LiveRecord.tsx:110`
- Modify: `frontend/src/components/meeting/TranscriptPanel.tsx`
- Modify: `frontend/src/components/meeting/TranscriptPanel.test.tsx`

**주의:** `LiveRecord.tsx:130`의 partial 렌더와 `TranscriptBlock.tsx`는 수정하지 않는다. 배지 색상은 라벨 기준 유지(이름 바꿔도 색 불변).

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/components/meeting/SpeakerLabel.test.tsx`의 `describe('SpeakerLabel')` 안에 추가:

```ts
  it('speakerName이 있으면 라벨 대신 이름을 렌더', () => {
    render(<SpeakerLabel speakerLabel="화자 1" speakerName="앨리스" />)
    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('화자 1')).not.toBeInTheDocument()
  })

  it('speakerName이 null이면 라벨로 fallback', () => {
    render(<SpeakerLabel speakerLabel="화자 1" speakerName={null} />)
    expect(screen.getByText('화자 1')).toBeInTheDocument()
  })
```

`frontend/src/components/meeting/TranscriptPanel.test.tsx` 끝에 describe 추가 (파일 상단 import에 `beforeEach`, `useTranscriptStore` 추가 필요):

```ts
import { useTranscriptStore } from '../../stores/transcriptStore'
```

```ts
describe('TranscriptPanel speaker_name', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('speaker_name이 있으면 배지에 이름 표시', () => {
    render(
      <TranscriptPanel
        meetingId={1}
        transcripts={[{ ...mockTranscripts[0], speaker_name: '앨리스' }]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )

    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('SPEAKER_00')).not.toBeInTheDocument()
  })

  it('rename 후 store setSpeakerName 호출 시 배지가 즉시 갱신된다', () => {
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '첫 번째 발화입니다.',
        speaker_label: 'SPEAKER_00',
        started_at_ms: 0,
        ended_at_ms: 3000,
        sequence_number: 1,
        applied: false,
      },
    ])

    render(
      <TranscriptPanel
        meetingId={1}
        transcripts={[mockTranscripts[0]]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    )
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()

    act(() => {
      useTranscriptStore.getState().setSpeakerName('SPEAKER_00', '앨리스')
    })

    expect(screen.getByText('앨리스')).toBeInTheDocument()
    expect(screen.queryByText('SPEAKER_00')).not.toBeInTheDocument()
  })
})
```

(`act`는 `import { act } from '@testing-library/react'`로 가져온다. 기존 테스트가 store를 쓰지 않으므로 기존 describe에는 영향 없음 — 단, 새 describe의 beforeEach reset이 전역 store 누수를 막는다.)

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run src/components/meeting/SpeakerLabel.test.tsx src/components/meeting/TranscriptPanel.test.tsx
```

Expected: 신규 테스트 FAIL.

- [ ] **Step 3: 구현**

`frontend/src/components/meeting/SpeakerLabel.tsx` — props 확장 (색상은 라벨 기준 유지):

```tsx
interface SpeakerLabelProps {
  speakerLabel: string
  /** 표시 이름. null/undefined면 라벨로 fallback */
  speakerName?: string | null
}

export function SpeakerLabel({ speakerLabel, speakerName }: SpeakerLabelProps) {
  const colorClass = speakerColor(speakerLabel)

  return (
    <span
      role="status"
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${colorClass}`}
    >
      {speakerName ?? speakerLabel}
    </span>
  )
}
```

`frontend/src/components/meeting/FullRecord.tsx:93`:

```tsx
                  <SpeakerLabel speakerLabel={item.speaker_label} speakerName={item.speaker_name} />
```

`frontend/src/components/meeting/LiveRecord.tsx:110`:

```tsx
              <SpeakerLabel speakerLabel={item.speaker_label} speakerName={item.speaker_name} />
```

`frontend/src/components/meeting/TranscriptPanel.tsx` — `contentOverrides` memo 아래에 추가:

```tsx
  // rename 즉시 반영: SpeakerPanel이 store finals의 speaker_name을 갱신하면
  // prop(transcripts)이 stale해도 store 값을 우선 표시한다.
  const speakerNameOverrides = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const f of storeFinals) map.set(f.id, f.speaker_name ?? null)
    return map
  }, [storeFinals])
```

배지 렌더(88-90행) 교체:

```tsx
              <span className="text-xs font-semibold text-indigo-600">
                {(speakerNameOverrides.has(transcript.id)
                  ? speakerNameOverrides.get(transcript.id)
                  : transcript.speaker_name) ?? transcript.speaker_label}
              </span>
```

- [ ] **Step 4: 통과 확인 + 빌드**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run src/components/meeting/SpeakerLabel.test.tsx src/components/meeting/TranscriptPanel.test.tsx src/components/meeting/LiveRecord.test.tsx && npx vite build
```

Expected: 전부 PASS (LiveRecord 기존 테스트 회귀 확인 포함), vite build 성공.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add frontend/src/components/meeting/SpeakerLabel.tsx frontend/src/components/meeting/SpeakerLabel.test.tsx frontend/src/components/meeting/FullRecord.tsx frontend/src/components/meeting/LiveRecord.tsx frontend/src/components/meeting/TranscriptPanel.tsx frontend/src/components/meeting/TranscriptPanel.test.tsx && git commit -m "feat(speakers): 트랜스크립트 배지에 speaker_name fallback 렌더

색상은 라벨 기준 유지. TranscriptPanel은 store finals 우선(rename 즉시 반영).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: SpeakerPanel — rename/reset 시 store 동기화

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerPanel.tsx`
- Create: `frontend/src/components/meeting/SpeakerPanel.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/components/meeting/SpeakerPanel.test.tsx` 생성:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SpeakerPanel } from './SpeakerPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

vi.mock('../../api/speakers', () => ({
  getSpeakers: vi.fn().mockResolvedValue([{ id: '화자 1', name: '화자 1' }]),
  renameSpeaker: vi.fn().mockResolvedValue({ id: '화자 1', name: '앨리스' }),
  resetSpeakers: vi.fn().mockResolvedValue(undefined),
}))

describe('SpeakerPanel store 동기화', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().loadFinals([
      {
        id: 1,
        content: '안녕하세요',
        speaker_label: '화자 1',
        started_at_ms: 0,
        ended_at_ms: 1000,
        sequence_number: 1,
        applied: false,
      },
    ])
  })

  it('rename 성공 시 store finals의 speaker_name을 갱신한다', async () => {
    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    const editBtn = await screen.findByTitle('클릭하여 이름 편집')
    fireEvent.click(editBtn)
    const input = screen.getByPlaceholderText('화자 1')
    fireEvent.change(input, { target: { value: '앨리스' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(useTranscriptStore.getState().finals[0].speaker_name).toBe('앨리스')
    })
  })

  it('초기화 시 store finals의 speaker_name을 모두 제거한다', async () => {
    useTranscriptStore.getState().setSpeakerName('화자 1', '앨리스')
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<SpeakerPanel meetingId={1} isRecording={false} />)

    const resetBtn = await screen.findByTitle('화자 DB 초기화')
    fireEvent.click(resetBtn)

    await waitFor(() => {
      expect(useTranscriptStore.getState().finals[0].speaker_name ?? null).toBeNull()
    })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run src/components/meeting/SpeakerPanel.test.tsx
```

Expected: 두 테스트 모두 FAIL (store 갱신 없음).

- [ ] **Step 3: 구현**

`frontend/src/components/meeting/SpeakerPanel.tsx` 수정 3곳:

컴포넌트 상단(기존 `const finals = useTranscriptStore(...)` 근처)에 액션 구독 추가:

```ts
  const setSpeakerName = useTranscriptStore((s) => s.setSpeakerName)
  const clearSpeakerNames = useTranscriptStore((s) => s.clearSpeakerNames)
```

`submitEdit` 성공 분기 — store 갱신 추가 (name == id면 이름 해제):

```ts
  async function submitEdit(speaker: Speaker) {
    const name = editValue.trim()
    if (name && name !== speaker.name) {
      const updated = await renameSpeaker(meetingId, speaker.id, name).catch(() => null)
      if (updated) {
        setSpeakers((prev) =>
          prev.map((s) => (s.id === speaker.id ? { ...s, name: updated.name } : s))
        )
        setSpeakerName(speaker.id, updated.name === speaker.id ? null : updated.name)
      }
    }
    setEditingId(null)
  }
```

`handleReset` — store 초기화 추가:

```ts
  async function handleReset() {
    if (!confirm('화자 DB를 초기화하면 화자 구분이 처음부터 다시 시작됩니다. 계속할까요?')) return
    await resetSpeakers(meetingId).catch(() => {})
    setSpeakers([])
    clearSpeakerNames()
  }
```

- [ ] **Step 4: 통과 확인 + 전체 프론트 검증**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run && npx vite build
```

Expected: 전부 PASS (전체 스위트 회귀 없음), vite build 성공.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak && git add frontend/src/components/meeting/SpeakerPanel.tsx frontend/src/components/meeting/SpeakerPanel.test.tsx && git commit -m "feat(speakers): rename/reset 시 transcriptStore speaker_name 즉시 동기화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 검증

- [ ] **Step 1: backend 전체 스펙**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec
```

Expected: 0 failures.

- [ ] **Step 2: frontend 전체 테스트 + 빌드**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npx vitest run && npx vite build
```

Expected: 0 failures, build 성공. (`npm run build`의 `tsc -b` 기존 무관 에러 9개는 무시 — vite build 통과가 기준)

- [ ] **Step 3: 미커밋 타작업 파일 무결성 확인**

```bash
cd /Users/jji/project/ddobakddobak && git status --short
```

Expected: `backend/app/services/llm_service.rb`, `frontend/src/hooks/useMicCapture.ts`, `frontend/src-tauri/gen/**`, `idea.md`, `4교시백업.md`만 변경 상태로 남아 있고, 이번 작업 파일은 전부 커밋됨.

- [ ] **Step 4: 수동 검증 시나리오 안내 (사용자)**

회의 149에서: 화자 rename → 트랜스크립트 배지에 이름 표시 확인, 검색 화자 필터에 이름 입력 → hit 확인.
