# 임베딩 지연·배치 백필 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 임베딩을 라이브 녹음 핫패스에서 제거하고, 전사 content 확정 경계에서 배치(EmbedBackfillJob)로만 계산해 SQLite writer-lock 경합에 의한 라이브 끊김을 없앤다.

**Architecture:** derived-index 모델 — 행 콜백은 임베딩을 인라인 계산하지 않고 *무효화(삭제)* 만 한다. 계산은 `EmbedBackfillJob`(diff 기반)이 stop/heal/파일STT/import/glossary/단건편집 경계에서 `Meeting#reconcile_embeddings!`로만 수행. 규칙 하나: "쓰면 무효화, 계산은 배치."

**Tech Stack:** Rails 7, ActiveJob(dev `:async`/prod `solid_queue`), SQLite(WAL), RSpec, FactoryBot.

## Global Constraints

- 범위 = 100% 백엔드(`backend/`). 프론트 무변경.
- 동시성 레버 금지: `busy_timeout` 상향·스레드 증가·WAL 변경 **하지 말 것**(틀린 레버 — writer-writer 경합 못 풂).
- 기능 변경 0: 임베딩은 여전히 모든 전사에 대해 생성됨 — *시점만* 라이브 밖으로 이동.
- 기존 임베딩 모델/sidecar 무변경. `TranscriptEmbedding::MODEL_VERSION` = `"kure-v1"`.
- rspec 기준선 **1347 green** 유지(Task 2가 `transcript_embeddable_spec.rb` 3건을 새 동작으로 재작성하는 것 외 회귀 0).
- 커밋 메시지는 한글 conventional. 커밋은 각 Task 끝에서.
- 테스트 sidecar stub 패턴: `allow(SidecarClient).to receive(:new).and_return(sidecar)` + `allow(sidecar).to receive(:embed) { |texts| texts.map { [1.0, 0.0] } }`.

---

### Task 1: EmbedBackfillJob 회의 스코핑

**Files:**
- Modify: `backend/app/jobs/embed_backfill_job.rb`
- Test: `backend/spec/jobs/embed_backfill_job_spec.rb`

**Interfaces:**
- Produces: `EmbedBackfillJob#perform(batch_size: 64, meeting_id: nil)` — `meeting_id` 주면 그 회의 전사만 백필. nil이면 글로벌(현행).

- [ ] **Step 1: 실패 테스트 작성** — `embed_backfill_job_spec.rb`에 추가

```ruby
  it "meeting_id 스코핑 — 그 회의 전사만 처리한다" do
    m1 = create(:meeting)
    m2 = create(:meeting)
    t1 = create(:transcript, meeting: m1, content: "회의1 내용")
    create(:transcript, meeting: m2, content: "회의2 내용")
    TranscriptEmbedding.delete_all

    described_class.perform_now(meeting_id: m1.id)

    expect(TranscriptEmbedding.where(meeting_id: m1.id).count).to eq(1)
    expect(TranscriptEmbedding.where(meeting_id: m2.id).count).to eq(0)
    expect(TranscriptEmbedding.exists?(transcript_id: t1.id)).to be(true)
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/embed_backfill_job_spec.rb -e "meeting_id 스코핑"`
Expected: FAIL — `perform_now` got unexpected keyword `meeting_id` (ArgumentError).

- [ ] **Step 3: 최소 구현** — `embed_backfill_job.rb`를 아래로 교체

```ruby
# 임베딩 없거나 구버전 model_version인 전사를 배치 임베딩·upsert. 재실행 가능(idempotent).
# 초기 적재 + 모델 교체 재임베딩 + 라이브 밖 지연 백필에 사용. 1회성 스크립트 금지 — 항상 이 잡 경유.
class EmbedBackfillJob < ApplicationJob
  queue_as :default

  # meeting_id 주면 그 회의 전사만, nil이면 전역. 둘 다 diff(현버전 임베딩 없는 전사)만 처리.
  def perform(batch_size: 64, meeting_id: nil)
    pending_transcript_ids(meeting_id).each_slice(batch_size) do |ids|
      transcripts = Transcript.where(id: ids).where.not(content: [nil, ""]).to_a
      next if transcripts.empty?

      vecs = SidecarClient.new.embed(transcripts.map(&:content))
      transcripts.each_with_index do |t, i|
        vec = vecs[i]
        next if vec.blank?
        rec = TranscriptEmbedding.find_or_initialize_by(transcript_id: t.id)
        rec.meeting_id    = t.meeting_id
        rec.model_version = TranscriptEmbedding::MODEL_VERSION
        rec.dim           = vec.size
        rec.embedding     = TranscriptEmbedding.pack_vector(vec)
        rec.save!
      end
    end
  end

  private

  # 현 모델 버전 임베딩이 없는 전사 id. (없음 OR 구버전 둘 다 포함) meeting_id로 선택 스코핑.
  def pending_transcript_ids(meeting_id = nil)
    current = TranscriptEmbedding.where(model_version: TranscriptEmbedding::MODEL_VERSION).select(:transcript_id)
    scope = Transcript.where.not(id: current).where.not(content: [nil, ""])
    scope = scope.where(meeting_id: meeting_id) if meeting_id
    scope.pluck(:id)
  end
end
```

- [ ] **Step 4: 통과 확인 (스코핑 + 기존 전부)**

Run: `cd backend && bundle exec rspec spec/jobs/embed_backfill_job_spec.rb`
Expected: PASS (신규 1 + 기존 3).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/embed_backfill_job.rb backend/spec/jobs/embed_backfill_job_spec.rb
git commit -m "feat(embedding): EmbedBackfillJob에 meeting_id 스코핑 추가"
```

---

### Task 2: embeddable — 인라인 계산 제거 + content 변경 시 무효화

**Files:**
- Modify: `backend/app/models/concerns/embeddable.rb`
- Test: `backend/spec/models/transcript_embeddable_spec.rb` (전면 재작성)

**Interfaces:**
- Consumes: `EmbedBackfillJob`(Task 1) — 직접 호출 안 하지만, create가 더 이상 인라인 임베딩 안 하므로 백필이 흡수함을 전제.
- Produces: Transcript create → 임베딩 잡/행 0. content `update` → 그 전사의 `TranscriptEmbedding` 행 삭제(무효화). content 외 update → 무동작.

- [ ] **Step 1: 실패 테스트 작성** — `transcript_embeddable_spec.rb` 전체를 아래로 교체

```ruby
require "rails_helper"

RSpec.describe "Transcript embedding lifecycle", type: :model do
  include ActiveJob::TestHelper

  it "생성 시 인라인 임베딩 잡을 enqueue하지 않는다(백필이 흡수)" do
    expect {
      create(:transcript, content: "안건 논의")
    }.not_to have_enqueued_job(EmbedTranscriptJob)
  end

  it "content 변경 시 기존 임베딩 행을 무효화(삭제)한다" do
    t = create(:transcript, content: "처음")
    TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 2,
      embedding: TranscriptEmbedding.pack_vector([0.1, 0.2])
    )
    expect {
      t.update!(content: "수정됨")
    }.to change { TranscriptEmbedding.exists?(transcript_id: t.id) }.from(true).to(false)
  end

  it "content 외 컬럼만 바뀌면 임베딩을 무효화하지 않는다" do
    t = create(:transcript, content: "고정")
    TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 2,
      embedding: TranscriptEmbedding.pack_vector([0.1, 0.2])
    )
    expect {
      t.update!(speaker_name: "김철수")
    }.not_to change { TranscriptEmbedding.exists?(transcript_id: t.id) }
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/transcript_embeddable_spec.rb`
Expected: FAIL — 생성 시 여전히 EmbedTranscriptJob enqueue됨 / content 변경이 행을 안 지움.

- [ ] **Step 3: 최소 구현** — `embeddable.rb`를 아래로 교체

```ruby
# 임베딩은 전사 content에서 파생된 검색 인덱스다. 행 콜백은 임베딩을 인라인 계산하지 않는다
# (라이브 핫패스에서 SQLite writer-lock 경합 → 녹음 끊김의 원인). 계산은 EmbedBackfillJob가
# content 확정 경계(stop/heal/파일STT/import/glossary/단건편집)에서 배치로만 수행한다.
# 콜백의 책임은 content가 바뀐 행의 stale 임베딩을 무효화(삭제)하는 것뿐 — 다음 백필이 재생성한다.
module Embeddable
  extend ActiveSupport::Concern

  class_methods do
    def embeddable(content_column: :content)
      after_update_commit :invalidate_embedding
      define_method(:embeddable_content_column) { content_column }
    end
  end

  private

  # content가 변경된 경우에만 stale 임베딩 행을 삭제한다(로컬 write만, sidecar 호출 0).
  def invalidate_embedding
    col = embeddable_content_column.to_s
    return unless saved_change_to_attribute?(col)

    TranscriptEmbedding.where(transcript_id: id).delete_all
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/transcript_embeddable_spec.rb spec/jobs/embed_transcript_job_spec.rb`
Expected: PASS (EmbedTranscriptJob 클래스 자체는 무변경이라 그 스펙도 green).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/concerns/embeddable.rb backend/spec/models/transcript_embeddable_spec.rb
git commit -m "feat(embedding): 인라인 임베딩 제거 — content 변경 시 무효화만(라이브 끊김 차단)"
```

---

### Task 3: Meeting#reconcile_embeddings! + 라이브 경계(stop, heal)

**Files:**
- Modify: `backend/app/models/meeting.rb` (`reconcile_embeddings!` 추가, `heal_stale_recording!` 배선)
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (`stop` 배선)
- Test: `backend/spec/models/meeting_spec.rb`, `backend/spec/requests/api/v1/meetings_spec.rb` (해당 파일에 추가)

**Interfaces:**
- Consumes: `EmbedBackfillJob#perform(meeting_id:)`(Task 1).
- Produces: `Meeting#reconcile_embeddings!` → `EmbedBackfillJob.perform_later(meeting_id: id)`. stop/heal가 전사 있을 때 이를 호출.

- [ ] **Step 1: 실패 테스트 작성** — `meeting_spec.rb`에 추가

```ruby
  describe "#reconcile_embeddings!" do
    include ActiveJob::TestHelper

    it "EmbedBackfillJob을 meeting_id로 enqueue한다" do
      m = create(:meeting)
      expect {
        m.reconcile_embeddings!
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: m.id)
    end
  end

  describe "#heal_stale_recording! 임베딩 reconcile" do
    include ActiveJob::TestHelper

    it "전사가 있으면 백필을 enqueue한다" do
      m = create(:meeting, status: "recording", recorder_heartbeat_at: 5.minutes.ago)
      create(:transcript, meeting: m, content: "내용")
      expect {
        m.heal_stale_recording!
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: m.id)
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_spec.rb -e "reconcile_embeddings" -e "heal_stale_recording! 임베딩"`
Expected: FAIL — `reconcile_embeddings!` 미정의 / heal이 백필 미enqueue.

- [ ] **Step 3a: `reconcile_embeddings!` 추가** — `meeting.rb`, `heal_stale_recording!` 메서드 위에 삽입

```ruby
  # 이 회의의 전사 content가 확정된 시점에 임베딩을 일관되게 맞춘다(배치, 라이브 밖).
  # 라이브/파일STT/import 핫패스에서 인라인 임베딩을 제거했으므로, 확정 경계에서 이 메서드로 흡수한다.
  # diff 기반(EmbedBackfillJob)이라 신규 전사 + 무효화로 삭제된 행을 모두 재생성한다. 멱등.
  def reconcile_embeddings!
    EmbedBackfillJob.perform_later(meeting_id: id)
  end
```

- [ ] **Step 3b: `heal_stale_recording!` 배선** — `meeting.rb`의 아래 블록을 찾아

```ruby
    if transcripts.exists?
      MeetingFinalizerJob.perform_later(id)
      MeetingSummarizationJob.perform_later(id, type: "final")
    end
```

다음으로 교체

```ruby
    if transcripts.exists?
      MeetingFinalizerJob.perform_later(id)
      MeetingSummarizationJob.perform_later(id, type: "final")
      reconcile_embeddings!
    end
```

- [ ] **Step 3c: `stop` 배선** — `meetings_controller.rb`의 `stop` 액션, 아래 블록을 찾아

```ruby
        skip = params[:skip_summary].to_s == "true"
        if !skip && @meeting.transcripts.exists?
          MeetingFinalizerJob.perform_later(@meeting.id)
          MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
        end
```

다음으로 교체 (임베딩은 검색용 — `skip_summary`와 무관하게 전사 있으면 reconcile)

```ruby
        skip = params[:skip_summary].to_s == "true"
        if @meeting.transcripts.exists?
          unless skip
            MeetingFinalizerJob.perform_later(@meeting.id)
            MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
          end
          @meeting.reconcile_embeddings!
        end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_spec.rb -e "reconcile_embeddings" -e "heal_stale_recording! 임베딩"`
Expected: PASS.

- [ ] **Step 5: stop 요청 스펙 추가** — `spec/requests/api/v1/meetings_spec.rb`에 stop describe 블록 내 추가 (기존 stop 셋업 패턴 따름)

```ruby
    it "stop 시 임베딩 백필을 enqueue한다" do
      include_context # (기존 stop 셋업이 let/before로 있으면 그대로 사용)
    end
```

> 구현자 주의: 이 파일의 기존 `stop` 테스트 셋업(로그인·recording 회의·전사 생성)을 재사용. 없으면 `have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)` 단언만 stop 호출 뒤에 추가. `ActiveJob::TestHelper` 포함 필요.

- [ ] **Step 6: 통과 확인 + 커밋**

```bash
cd backend && bundle exec rspec spec/models/meeting_spec.rb spec/requests/api/v1/meetings_spec.rb
git add backend/app/models/meeting.rb backend/app/controllers/api/v1/meetings_controller.rb backend/spec/models/meeting_spec.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(embedding): reconcile_embeddings! + 라이브 stop/heal 경계 배선"
```

---

### Task 4: 배치 경계(파일STT 완료, 임포트 완료) + re_diarize 주석

**Files:**
- Modify: `backend/app/jobs/file_transcription_job.rb`
- Modify: `backend/app/services/project_importer.rb`
- Modify: `backend/app/jobs/re_diarize_job.rb` (주석만)
- Test: `backend/spec/jobs/file_transcription_job_spec.rb`, `backend/spec/services/project_importer_spec.rb`

**Interfaces:**
- Consumes: `Meeting#reconcile_embeddings!`(Task 3).

- [ ] **Step 1: 파일STT 실패 테스트** — `file_transcription_job_spec.rb`에 추가 (기존 sidecar stub 셋업 재사용; 없으면 `transcribe_file`/`get_speakers` stub 추가)

```ruby
    it "전사 완료 후 임베딩 백필을 enqueue한다" do
      expect {
        described_class.perform_now(meeting.id)
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)
    end
```

> 구현자 주의: 이 잡은 sidecar `transcribe_file`, `get_speakers` 등을 호출. 기존 스펙의 stub 셋업(`SidecarClient` instance_double, `transcribe_file` → segments 반환)을 그대로 쓴다. `ActiveJob::TestHelper` 포함. meeting은 `transcribing` 상태여야 perform이 진행됨(`create(:meeting, status: "transcribing", audio_file_path: <존재경로>)`).

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/file_transcription_job_spec.rb -e "임베딩 백필"`
Expected: FAIL — 백필 미enqueue.

- [ ] **Step 3a: 파일STT 배선** — `file_transcription_job.rb`의 완료 update! 뒤(브로드캐스트 전후 무방), 아래를 찾아

```ruby
    meeting.update!(
      status: :completed,
      transcription_progress: 100,
      ended_at: Time.current,
      stt_engine: result["engine"]
    )
```

바로 다음 줄에 추가

```ruby
    # 전사 content 확정 — 라이브 밖에서 임베딩 일괄 reconcile(재STT 새 전사 포함).
    meeting.reconcile_embeddings!
```

- [ ] **Step 3b: 임포트 배선** — `project_importer.rb`의 `import_meeting_children` 메서드 끝(transcripts/summaries/... 적재 후), 메서드 마지막 줄에 추가

```ruby
    # 임포트로 생성된 전사는 인라인 임베딩이 없으므로(라이브 끊김 방지 정책), 회의별로 reconcile.
    meeting.reconcile_embeddings! if meeting.transcripts.exists?
```

> 구현자 주의: `import_meeting_children(meeting, m, tag_map)` 메서드 본문 끝. `meeting`은 이미 저장된 레코드.

- [ ] **Step 3c: re_diarize 주석** — `re_diarize_job.rb`의 완료 update! 위에 주석 추가

```ruby
    # 재분리는 speaker_label/speaker_name만 바꾸고 content는 불변 → 임베딩(content 파생) 유효.
    # 따라서 reconcile_embeddings! 불필요. (content를 건드리게 바뀌면 여기에 reconcile 추가할 것.)
    meeting.update!(status: :completed, transcription_progress: 100, re_diarize_started_at: nil)
```

- [ ] **Step 4: 임포트 테스트** — `project_importer_spec.rb`에 추가 (기존 import 셋업/픽스처 재사용)

```ruby
    it "임포트한 회의의 전사에 대해 임베딩 백필을 enqueue한다" do
      include ActiveJob::TestHelper
      expect {
        # (기존 import 실행 셋업 — 전사 포함 회의를 import)
      }.to have_enqueued_job(EmbedBackfillJob)
    end
```

> 구현자 주의: 기존 `project_importer_spec.rb`의 import 실행 헬퍼/픽스처를 재사용. 전사가 포함된 회의를 import하는 케이스에 `have_enqueued_job(EmbedBackfillJob)` 단언 추가. 픽스처에 전사가 없으면 추가.

- [ ] **Step 5: 통과 확인 + 커밋**

```bash
cd backend && bundle exec rspec spec/jobs/file_transcription_job_spec.rb spec/services/project_importer_spec.rb spec/jobs/re_diarize_job_spec.rb
git add backend/app/jobs/file_transcription_job.rb backend/app/services/project_importer.rb backend/app/jobs/re_diarize_job.rb backend/spec/jobs/file_transcription_job_spec.rb backend/spec/services/project_importer_spec.rb
git commit -m "feat(embedding): 파일STT·임포트 완료 경계 reconcile + re_diarize 생략 주석"
```

---

### Task 5: 편집 경계(glossary 재적용 ×3, 단건 수동편집)

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (462/499/525 `apply_all!` 뒤)
- Modify: `backend/app/controllers/api/v1/transcripts_controller.rb` (`update` 액션 `update!` 뒤)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`, `backend/spec/requests/api/v1/transcripts_spec.rb`

**Interfaces:**
- Consumes: `Meeting#reconcile_embeddings!`(Task 3). content 변경 → Task 2가 무효화 → reconcile가 재계산.

- [ ] **Step 1: 단건 편집 실패 테스트** — `transcripts_spec.rb`의 `update`(PATCH) 케이스에 추가

```ruby
    it "content 수정 시 임베딩 백필을 enqueue한다" do
      # (기존 update 셋업: 로그인·회의·transcript)
      expect {
        patch api_v1_transcript_path(transcript), params: { transcript: { content: "고친 내용" } }, headers: auth_headers
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: transcript.meeting_id)
    end
```

> 구현자 주의: 라우트/파라미터 키는 기존 transcripts_controller `update` 테스트를 따른다. `ActiveJob::TestHelper` 포함.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "임베딩 백필"`
Expected: FAIL.

- [ ] **Step 3a: 단건 편집 배선** — `transcripts_controller.rb`, `transcript.update!(content: content)` 다음 줄에 추가

```ruby
        transcript.update!(content: content)
        transcript.meeting.reconcile_embeddings!
```

- [ ] **Step 3b: glossary 3곳 배선** — `meetings_controller.rb`의 462/499/525 각 `apply_all!` 호출 뒤. 각 액션이 `corrected_count = MeetingGlossaryApplier.new(...).apply_all!` 형태이므로, 그 줄 다음에 추가

```ruby
        @meeting.reconcile_embeddings!
```

> 구현자 주의: 3개 액션(reapply_glossary, apply_glossary_entry, feedback 계열) 각각의 `apply_all!` 직후에 동일 한 줄. content가 안 바뀐 경우 무효화도 안 됐으니 reconcile는 멱등 no-op.

- [ ] **Step 4: glossary 요청 테스트** — `meetings_spec.rb`의 reapply_glossary 케이스에 추가

```ruby
    it "glossary 재적용 시 임베딩 백필을 enqueue한다" do
      # (기존 reapply_glossary 셋업)
      expect {
        post reapply_glossary_api_v1_meeting_path(meeting), headers: auth_headers
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)
    end
```

> 구현자 주의: 라우트명은 기존 reapply_glossary 테스트를 따른다.

- [ ] **Step 5: 통과 확인 + 커밋**

```bash
cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb spec/requests/api/v1/meetings_spec.rb
git add backend/app/controllers/api/v1/meetings_controller.rb backend/app/controllers/api/v1/transcripts_controller.rb backend/spec/requests/api/v1/transcripts_spec.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(embedding): glossary 재적용·단건 편집 경계 reconcile"
```

---

### Task 6: 안전망 — recurring 백필(prod)

**Files:**
- Modify: `backend/config/recurring.yml`
- (rake `lib/tasks/embeddings.rake`는 무변경 — 글로벌 백필 그대로.)

**Interfaces:** 없음(설정).

- [ ] **Step 1: recurring.yml production에 항목 추가** — `production:` 블록 끝에 추가

```yaml
  embedding_backfill:
    class: EmbedBackfillJob
    queue: default
    schedule: every 10 minutes
```

> 주의: `development:`에는 추가하지 않는다 — dev는 `:async` 어댑터라 solid_queue recurring이 동작하지 않음(무영향). dev 백필은 `rails embeddings:backfill` 수동.

- [ ] **Step 2: YAML 유효성 확인**

Run: `cd backend && ruby -ryaml -e "YAML.load_file('config/recurring.yml'); puts 'ok'"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add backend/config/recurring.yml
git commit -m "feat(embedding): prod 주기 백필 안전망(recurring EmbedBackfillJob)"
```

---

### Task 7: 전체 회귀 + 곁다리(읽기전용)

**Files:** 없음(검증·조사).

- [ ] **Step 1: 전체 rspec**

Run: `cd backend && bundle exec rspec`
Expected: 1347+ examples, 0 failures (Task 2가 `transcript_embeddable_spec` 3건을 새 동작으로 재작성했으나 총 green 유지; 신규 테스트로 카운트 증가).

- [ ] **Step 2: 미임베딩 58개 백필(머지 후, 수동)** — dev 서버에서

Run: `cd backend && rails embeddings:backfill`
Expected: `[embeddings:backfill] 완료 — 임베딩 N건` (N이 기존 +58 근방으로 증가). sidecar 가동 필요.

- [ ] **Step 3: 회의 228 정합성 조사(읽기전용)** — 코드 변경과 분리

228이 16:08 completed됐다가 16:48까지 전사 재유입된 건의 정합성(전사 분리/중복) 확인. `rails runner`로 228의 transcripts를 sequence_number·started_at_ms 순 점검, 중복 content/시간겹침 여부 리포트. 수정은 별도 판단(이 plan 범위 밖).

---

## Self-Review

**Spec coverage:**
- §1 인라인 제거 → Task 2 ✅
- §2 backfill 스코핑 → Task 1 ✅
- §3 reconcile_embeddings! + 7경계(stop/heal/파일STT/import/glossary/단건/re_diarize생략) → Task 3,4,5 ✅
- §4 안전망(rake 유지 + recurring) → Task 6 ✅
- §5 곁다리(58 백필, 228 조사) → Task 7 ✅
- 테스트(단위/통합/회귀) → 각 Task + Task 7 ✅

**Placeholder scan:** 요청 스펙 Step들(Task 3 Step5, Task 4 Step1/4, Task 5)에 "기존 셋업 재사용" 지시 있음 — 실제 코드가 아닌 부분은 기존 테스트 픽스처 의존이라 구현자 주의로 명시. 핵심 단언(`have_enqueued_job(EmbedBackfillJob).with(meeting_id:)`)은 구체화됨.

**Type consistency:** `reconcile_embeddings!`(인자 없음) → `EmbedBackfillJob.perform_later(meeting_id: id)` → `perform(batch_size: 64, meeting_id: nil)`. 전 Task 일관. 무효화 = `TranscriptEmbedding.where(transcript_id: id).delete_all`. ✅
