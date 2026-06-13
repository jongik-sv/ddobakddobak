# 수동 요약 + 종료 확인 + 일시정지/빈기록 요약 게이트 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 중 수동 요약 버튼 추가, 종료 시 최종요약 여부 확인, 일시정지 중·빈 기록 시 요약 차단.

**Architecture:** 백엔드에 `meetings.paused_at` 컬럼을 추가해 클라이언트 일시정지를 서버 cron이 인지하게 한다. 요약 트리거(프론트 인터벌·백엔드 cron·수동·종료)에 일시정지/빈기록 가드를 일관 적용한다. 종료 흐름에 3선택 다이얼로그를 끼워 final 요약을 옵트인으로 만든다.

**Tech Stack:** Rails 8.1 + RSpec(request/job spec) / React + TypeScript + Zustand + Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-13-manual-summary-and-summary-gating-design.md`

**참고 — 이미 존재(추가 불필요):**
- `MeetingSummarizationJob#generate_minutes_final`은 `return if transcripts.empty?` (line 187) 가드 보유.
- `#generate_minutes_realtime`은 `return if new_transcripts.empty?` (line 102) 가드 보유.
- 프론트 인터벌 타이머는 `isPaused` 시 정지 (`useLiveRecording.ts` line 582).

**범위 밖:** 요구사항 5(시스템 오디오 꼬리 잘림) — 별도 작업.

---

## 파일 구조

**백엔드**
- Create: `backend/db/migrate/<ts>_add_paused_at_to_meetings.rb` — `paused_at` 컬럼
- Modify: `backend/config/routes.rb` — `pause`/`resume` member 라우트
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` — `pause`/`resume` 액션, `stop` 가드, `summarize` 가드, before_action 목록
- Modify: `backend/app/jobs/summarization_job.rb` — paused 제외
- Modify: `backend/app/jobs/meeting_summarization_job.rb` — realtime paused 가드
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`, `backend/spec/jobs/summarization_job_spec.rb`, `backend/spec/jobs/meeting_summarization_job_spec.rb`

**프론트**
- Modify: `frontend/src/api/meetings.ts` — `pauseMeeting`/`resumeMeeting`, `stopMeeting(skipSummary)`
- Create: `frontend/src/components/meeting/StopMeetingDialog.tsx` — 3선택 종료 다이얼로그
- Modify: `frontend/src/hooks/useLiveRecording.ts` — pause/resume API, flush 제거, `handleManualSummary`, 빈가드, 종료 확인 state
- Modify: `frontend/src/components/meeting/DesktopRecordControls.tsx` / `MobileRecordControls.tsx` — "지금 요약" 버튼
- Modify: `frontend/src/pages/MeetingLivePage.tsx` — 종료 다이얼로그 렌더 + `onManualSummary` 전달
- Test: `frontend/src/components/meeting/StopMeetingDialog.test.tsx`, `frontend/src/pages/MeetingLivePage.test.tsx`

**테스트 실행**
- 백엔드: `cd backend && bundle exec rspec <path>`
- 프론트: `cd frontend && npx vitest run <path>`

---

## Task 1: `paused_at` 마이그레이션

**Files:**
- Create: `backend/db/migrate/<ts>_add_paused_at_to_meetings.rb`

> 주의(메모리 `feedback_rails_pending_migration_trap`): 마이그 파일 추가 후 즉시 migrate 하지 않으면 가동 중 dev 서버가 PendingMigrationError로 전 요청 500. 생성과 migrate를 한 스텝에 처리한다.

- [ ] **Step 1: 마이그레이션 생성**

Run:
```bash
cd backend && bin/rails generate migration AddPausedAtToMeetings paused_at:datetime
```
Expected: `db/migrate/<ts>_add_paused_at_to_meetings.rb` 생성. 내용:
```ruby
class AddPausedAtToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :paused_at, :datetime
  end
end
```

- [ ] **Step 2: migrate 실행**

Run: `cd backend && bin/rails db:migrate`
Expected: `add_column(:meetings, :paused_at, :datetime)` 성공, `db/schema.rb` 갱신(`t.datetime "paused_at"`).

- [ ] **Step 3: 커밋**

```bash
git add backend/db/migrate backend/db/schema.rb
git commit -m "feat(meetings): add paused_at column"
```

---

## Task 2: `pause`/`resume` 엔드포인트

**Files:**
- Modify: `backend/config/routes.rb:41` (member block, `post :reopen` 다음)
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:10-11` (before_action), `:194` (reopen 다음)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/requests/api/v1/meetings_spec.rb`의 `describe "POST /api/v1/meetings/:id/stop"` 블록(line ~482) 바로 뒤에 추가:
```ruby
  # ============================================================
  # POST /api/v1/meetings/:id/pause · resume
  # ============================================================
  describe "POST /api/v1/meetings/:id/pause" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "recording") }

    it "sets paused_at and broadcasts recording_paused" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(type: "recording_paused", meeting_id: meeting.id)
      )
      post "/api/v1/meetings/#{meeting.id}/pause"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.paused_at).not_to be_nil
    end

    it "returns 422 when not recording" do
      pending_meeting = create(:meeting, team: team, creator: user, status: "pending")
      post "/api/v1/meetings/#{pending_meeting.id}/pause"
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "forbids viewer participants" do
      foreign = create(:meeting, team: team, creator: other_user, status: "recording")
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      post "/api/v1/meetings/#{foreign.id}/pause"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/v1/meetings/:id/resume" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "recording", paused_at: Time.current) }

    it "clears paused_at and broadcasts recording_resumed" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(type: "recording_resumed", meeting_id: meeting.id)
      )
      post "/api/v1/meetings/#{meeting.id}/resume"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.paused_at).to be_nil
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "pause" -e "resume"`
Expected: FAIL (라우트 없음 → `ActionController::RoutingError` 또는 404).

- [ ] **Step 3: 라우트 추가**

`backend/config/routes.rb`의 member 블록에서 `post :reopen` 다음 줄에 추가:
```ruby
          post :pause
          post :resume
```

- [ ] **Step 4: before_action 목록에 pause/resume 추가**

`backend/app/controllers/api/v1/meetings_controller.rb` line 10-11 수정:
```ruby
      before_action :set_meeting, only: %i[show update destroy start stop reopen pause resume reset_content summarize summary transcripts export export_prompt feedback update_notes regenerate_stt regenerate_notes]
      before_action :authorize_meeting_control!, only: %i[update start stop reopen pause resume reset_content summarize update_notes regenerate_stt regenerate_notes feedback]
```

- [ ] **Step 5: 액션 구현**

같은 파일 `reopen` 액션(line ~194) 다음에 추가:
```ruby
      def pause
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(paused_at: Time.current)
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_paused", meeting_id: @meeting.id }
        )
        render json: { meeting: meeting_json(@meeting) }
      end

      def resume
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(paused_at: nil)
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_resumed", meeting_id: @meeting.id }
        )
        render json: { meeting: meeting_json(@meeting) }
      end
```

- [ ] **Step 6: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "pause" -e "resume"`
Expected: PASS (전부).

- [ ] **Step 7: 커밋**

```bash
git add backend/config/routes.rb backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(meetings): add pause/resume endpoints with paused_at"
```

---

## Task 3: `stop` — skip_summary + 빈기록 가드 + paused_at 정리

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:171-185`
- Test: `backend/spec/requests/api/v1/meetings_spec.rb` (기존 stop 블록 수정 + 신규)

- [ ] **Step 1: 기존 stop 테스트 수정 + 신규 테스트 작성**

`describe "POST /api/v1/meetings/:id/stop"` 블록(line 427~482) 안에서:

(a) 기존 "enqueues MeetingFinalizerJob" 테스트(line 441)를 **전사 있는 회의** 기준으로 교체:
```ruby
      it "enqueues finalizer + final summary when transcripts exist" do
        create(:transcript, meeting: meeting)
        expect(MeetingFinalizerJob).to receive(:perform_later).with(meeting.id)
        expect(MeetingSummarizationJob).to receive(:perform_later).with(meeting.id, type: "final")

        post "/api/v1/meetings/#{meeting.id}/stop"
      end
```

(b) `context "when meeting is recording"` 안에 신규 테스트 추가:
```ruby
      it "does NOT enqueue jobs when no transcripts exist" do
        expect(MeetingFinalizerJob).not_to receive(:perform_later)
        expect(MeetingSummarizationJob).not_to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop"
        expect(response).to have_http_status(:ok)
      end

      it "does NOT enqueue jobs when skip_summary=true even with transcripts" do
        create(:transcript, meeting: meeting)
        expect(MeetingFinalizerJob).not_to receive(:perform_later)
        expect(MeetingSummarizationJob).not_to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop", params: { skip_summary: "true" }
        expect(response).to have_http_status(:ok)
        expect(meeting.reload.status).to eq("completed")
      end

      it "clears paused_at on stop" do
        meeting.update!(paused_at: Time.current)
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop"
        expect(meeting.reload.paused_at).to be_nil
      end
```

> 기존 "broadcasts recording_stopped" / "clears the recording lock" 테스트는 job을 `allow`로 stub 하므로 그대로 통과한다(전사 없어도 broadcast/lock은 무조건 실행).

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "stop"`
Expected: 신규 "does NOT enqueue..." 테스트 FAIL (현재 무조건 enqueue), 수정한 enqueue 테스트는 PASS(전사 추가했으나 아직 가드 없음 — 통과).

- [ ] **Step 3: stop 액션 수정**

`backend/app/controllers/api/v1/meetings_controller.rb` `def stop` (line 167-186)을 교체:
```ruby
      def stop
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(status: :completed, ended_at: Time.current, paused_at: nil)

        # 녹음 단일성 락 해제 (재시작/reopen 시 stale 락 방지)
        RecordingLock.clear(@meeting.id)

        # 참여자에게 녹음 종료 브로드캐스트
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_stopped", meeting_id: @meeting.id }
        )

        # 사용자가 최종 요약을 건너뛰었거나(skip_summary) 라이브 기록이 없으면 요약 job 미enqueue.
        skip = params[:skip_summary].to_s == "true"
        if !skip && @meeting.transcripts.exists?
          MeetingFinalizerJob.perform_later(@meeting.id)
          MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
        end
        render json: { meeting: meeting_json(@meeting) }
      end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "stop"`
Expected: PASS (전부).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(meetings): gate stop summary on skip_summary and transcript presence"
```

---

## Task 4: `summarize` — 빈기록 가드

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb:219-228`
- Test: `backend/spec/requests/api/v1/meetings_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

Task 3에서 추가한 stop 블록 뒤에 신규 describe 추가:
```ruby
  describe "POST /api/v1/meetings/:id/summarize" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "recording") }

    it "enqueues realtime summary when transcripts exist" do
      create(:transcript, meeting: meeting)
      expect(MeetingSummarizationJob).to receive(:perform_later).with(meeting.id, type: "realtime")
      post "/api/v1/meetings/#{meeting.id}/summarize"
      expect(response).to have_http_status(:ok)
    end

    it "does NOT enqueue and returns skipped when no transcripts" do
      expect(MeetingSummarizationJob).not_to receive(:perform_later)
      post "/api/v1/meetings/#{meeting.id}/summarize"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["skipped"]).to eq("no_transcripts")
    end

    it "returns 422 when meeting is pending" do
      pending_meeting = create(:meeting, team: team, creator: user, status: "pending")
      post "/api/v1/meetings/#{pending_meeting.id}/summarize"
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "summarize"`
Expected: "does NOT enqueue..." FAIL (현재 무조건 enqueue).

- [ ] **Step 3: summarize 액션 수정**

`def summarize` (line 219-228)를 교체:
```ruby
      def summarize
        if @meeting.pending?
          render json: { error: "Meeting has not started yet" }, status: :unprocessable_entity
          return
        end

        unless @meeting.transcripts.exists?
          render json: { ok: true, skipped: "no_transcripts" }
          return
        end

        summary_type = @meeting.completed? ? "final" : "realtime"
        MeetingSummarizationJob.perform_later(@meeting.id, type: summary_type)
        render json: { ok: true }
      end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "summarize"`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/meetings_controller.rb backend/spec/requests/api/v1/meetings_spec.rb
git commit -m "feat(meetings): skip summarize enqueue when no transcripts"
```

---

## Task 5: `SummarizationJob` cron — paused 회의 제외

**Files:**
- Modify: `backend/app/jobs/summarization_job.rb:6-10`
- Test: `backend/spec/jobs/summarization_job_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`spec/jobs/summarization_job_spec.rb`의 `describe "#perform"` 안 `context "when there are recording meetings"` 블록에 추가:
```ruby
      it "skips paused meetings" do
        paused = create(:meeting, team: team, creator: user, status: "recording", paused_at: Time.current)
        expect {
          described_class.new.perform
        }.not_to have_enqueued_job(MeetingSummarizationJob).with(paused.id, type: "realtime")
      end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/summarization_job_spec.rb -e "skips paused"`
Expected: FAIL (현재 모든 recording enqueue).

- [ ] **Step 3: 구현**

`backend/app/jobs/summarization_job.rb`의 `perform`을 교체:
```ruby
  # 1분 cron으로 호출됨 (config/recurring.yml).
  # 각 recording 회의별로 MeetingSummarizationJob을 개별 enqueue하여 병렬 처리한다.
  # 일시정지(paused_at 설정)된 회의는 제외 — 클라이언트 일시정지 중 자동 요약 금지.
  def perform
    Meeting.recording.where(paused_at: nil).ids.each do |meeting_id|
      MeetingSummarizationJob.perform_later(meeting_id, type: "realtime")
    end
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/summarization_job_spec.rb`
Expected: PASS (전부).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/summarization_job.rb backend/spec/jobs/summarization_job_spec.rb
git commit -m "feat(summarization): exclude paused meetings from cron"
```

---

## Task 6: `MeetingSummarizationJob` realtime — paused 가드

**Files:**
- Modify: `backend/app/jobs/meeting_summarization_job.rb:93-97`
- Test: `backend/spec/jobs/meeting_summarization_job_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`spec/jobs/meeting_summarization_job_spec.rb`에 신규 context 추가(파일 내 적절한 describe 안, 없으면 최상위에):
```ruby
  describe "paused guard (realtime)" do
    let(:user) { create(:user) }
    let(:team) { create(:team, creator: user) }
    let(:meeting) { create(:meeting, team: team, creator: user, status: "recording", paused_at: Time.current) }

    it "does not call LLM when meeting is paused" do
      create(:transcript, meeting: meeting, applied_to_minutes: false)
      expect(LlmService).not_to receive(:new)
      described_class.new.perform(meeting.id, type: "realtime")
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/jobs/meeting_summarization_job_spec.rb -e "paused guard"`
Expected: FAIL (LlmService.new 호출됨).

- [ ] **Step 3: 구현**

`backend/app/jobs/meeting_summarization_job.rb` `generate_minutes_realtime` 시작부(line 93-97) 수정 — `return if meeting.pending?` 다음에 추가:
```ruby
  def generate_minutes_realtime(meeting)
    meeting.reload
    return if meeting.completed?
    return if meeting.pending?
    return if meeting.paused_at? # 일시정지 중 자동 요약 금지 (cron이 enqueue 후 일시정지된 경우 방어)
    return if stale_relative_to_user_action?(meeting)
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/jobs/meeting_summarization_job_spec.rb`
Expected: PASS (전부).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/jobs/meeting_summarization_job.rb backend/spec/jobs/meeting_summarization_job_spec.rb
git commit -m "feat(summarization): guard realtime job against paused meetings"
```

---

## Task 7: 프론트 API — pause/resume + stopMeeting(skipSummary)

**Files:**
- Modify: `frontend/src/api/meetings.ts:145-162`

- [ ] **Step 1: `stopMeeting` 시그니처 확장 + pause/resume 추가**

`frontend/src/api/meetings.ts`의 `stopMeeting` (line 145-148)을 교체:
```ts
export async function stopMeeting(id: number, opts?: { skipSummary?: boolean }): Promise<Meeting> {
  const searchParams = opts?.skipSummary ? { skip_summary: 'true' } : undefined
  const res: { meeting: Meeting } = await apiClient
    .post(`meetings/${id}/stop`, searchParams ? { searchParams } : undefined)
    .json()
  return res.meeting
}

export async function pauseMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/pause`).json()
  return res.meeting
}

export async function resumeMeeting(id: number): Promise<Meeting> {
  const res: { meeting: Meeting } = await apiClient.post(`meetings/${id}/resume`).json()
  return res.meeting
}
```

> `apiClient`는 ky 인스턴스(`searchParams` 옵션 지원). `reopenMeeting`(line 150) 위/주변에 자연스럽게 배치.

- [ ] **Step 2: 타입 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (에러 없음 — 기존 `stopMeeting(id)` 호출은 opts 옵셔널이라 호환).

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/api/meetings.ts
git commit -m "feat(api): add pauseMeeting/resumeMeeting and stopMeeting skipSummary"
```

---

## Task 8: `StopMeetingDialog` 컴포넌트

**Files:**
- Create: `frontend/src/components/meeting/StopMeetingDialog.tsx`
- Test: `frontend/src/components/meeting/StopMeetingDialog.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/components/meeting/StopMeetingDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StopMeetingDialog } from './StopMeetingDialog'

describe('StopMeetingDialog', () => {
  it('calls onSummarize when "요약하고 종료" clicked', () => {
    const onSummarize = vi.fn()
    const onSkip = vi.fn()
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={onSummarize} onSkip={onSkip} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '요약하고 종료' }))
    expect(onSummarize).toHaveBeenCalledOnce()
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('calls onSkip when "요약 없이 종료" clicked', () => {
    const onSummarize = vi.fn()
    const onSkip = vi.fn()
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={onSummarize} onSkip={onSkip} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '요약 없이 종료' }))
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('calls onCancel when "취소" clicked', () => {
    const onCancel = vi.fn()
    render(<StopMeetingDialog onSummarize={vi.fn()} onSkip={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/meeting/StopMeetingDialog.test.tsx`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 컴포넌트 구현**

`frontend/src/components/meeting/StopMeetingDialog.tsx`:
```tsx
import { Dialog } from '../ui/Dialog'

interface StopMeetingDialogProps {
  onSummarize: () => void
  onSkip: () => void
  onCancel: () => void
}

/** 회의 종료 시 최종 AI 요약 여부 확인. [요약하고 종료] / [요약 없이 종료] / [취소]. */
export function StopMeetingDialog({ onSummarize, onSkip, onCancel }: StopMeetingDialogProps) {
  return (
    <Dialog
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4"
    >
      <h3 className="text-base font-semibold text-gray-900 mb-2">회의 종료</h3>
      <p className="text-sm text-gray-600 mb-4">이번 회의를 AI로 최종 요약할까요?</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          취소
        </button>
        <button
          onClick={onSkip}
          className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
        >
          요약 없이 종료
        </button>
        <button
          onClick={onSummarize}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          요약하고 종료
        </button>
      </div>
    </Dialog>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/components/meeting/StopMeetingDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/meeting/StopMeetingDialog.tsx frontend/src/components/meeting/StopMeetingDialog.test.tsx
git commit -m "feat(meeting): add StopMeetingDialog (summarize/skip/cancel)"
```

---

## Task 9: `useLiveRecording` — pause/resume API, flush 제거, 수동요약, 빈가드, 종료 확인

**Files:**
- Modify: `frontend/src/hooks/useLiveRecording.ts` (imports ~18-28, finals selector ~87, handlePause 334-342, handleStop 352-397, interval 612-630, return ~639-665)

- [ ] **Step 1: import 및 finals 카운트 셀렉터 추가**

import 블록(line 18-28)에 `pauseMeeting, resumeMeeting` 추가:
```ts
  stopMeeting,
  pauseMeeting,
  resumeMeeting,
  triggerRealtimeSummary,
```
store 셀렉터(line 87-90 부근)에 추가:
```ts
  const finalsCount = useTranscriptStore((s) => s.finals.length)
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)
```
종료 확인용 state(line 76 `showResetConfirm` 부근)에 추가:
```ts
  const [showStopConfirm, setShowStopConfirm] = useState(false)
```

- [ ] **Step 2: handlePause/handleResume — flush 제거 + API 호출**

`handlePause`(334-342)와 `handleResume`(344-350)를 교체:
```ts
  const handlePause = () => {
    if (IS_TAURI) {
      pauseMicCapture()
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('pause_recording')).catch(() => {})
    }
    pause()
    // 일시정지 중 요약 완전 금지 — flush 호출하지 않음. 서버에 일시정지 통지(cron 자동요약 차단).
    pauseMeeting(meetingId).catch(() => {})
  }

  const handleResume = () => {
    if (IS_TAURI) {
      resumeMicCapture()
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('resume_recording')).catch(() => {})
    }
    resume()
    resumeMeeting(meetingId).catch(() => {})
  }
```

- [ ] **Step 3: handleManualSummary 추가**

`handleResume` 다음에 추가:
```ts
  // 회의 중 수동 "지금 요약" — realtime 경로(기존 설정 반영). 종료/일시정지/빈기록/요약중엔 호출 안 함.
  const handleManualSummary = () => {
    if (isPaused || finalsCount === 0 || isSummarizing) return
    triggerRealtimeSummary(meetingId).catch(() => {})
    // 다음 자동 주기 deadline 재anchor — 수동 직후 중복 요약 방지.
    summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
    setSummaryCountdown(summaryIntervalSec)
  }
```

- [ ] **Step 4: 인터벌 타이머 빈가드 추가**

interval 타이머의 트리거 분기(line 618-630)에서 `triggerRealtimeSummary` 호출 직전 빈가드 추가. line 618 `if (remaining <= 0) {` 블록을 교체:
```ts
      if (remaining <= 0) {
        // 라이브 기록 없으면 요약 스킵하고 다음 주기로.
        if (useTranscriptStore.getState().finals.length === 0) {
          summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
          setSummaryCountdown(summaryIntervalSec)
          return
        }
        summarizing = true
        setSummaryCountdown(0)
        showStatus('기록을 회의록에 적용 중...', 10000)
        triggerRealtimeSummary(meetingId)
          .then(() => showStatus('회의록 적용 완료'))
          .catch(() => {})
          .finally(() => {
            summarizing = false
            summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
            setSummaryCountdown(summaryIntervalSec)
          })
      } else {
```

- [ ] **Step 5: handleStop — 종료 확인 분기**

`handleStop`(352-397)을 두 함수로 분리. 기존 `handleStop`을 `performStop(skipSummary: boolean)`로 바꾸고, 새 `handleStop`은 확인을 띄운다.

`handleStop` 전체를 교체:
```ts
  // 종료 버튼: 라이브 기록 있으면 최종요약 여부 확인 다이얼로그, 없으면 바로 종료(skip).
  const handleStop = () => {
    if (finalsCount === 0) {
      performStop(true)
      return
    }
    setShowStopConfirm(true)
  }

  const confirmStopSummarize = () => {
    setShowStopConfirm(false)
    performStop(false)
  }

  const confirmStopSkip = () => {
    setShowStopConfirm(false)
    performStop(true)
  }

  const cancelStop = () => setShowStopConfirm(false)

  const performStop = async (skipSummary: boolean) => {
    setIsStopping(true)
    showStatus('회의 종료 중... 기록을 회의록에 적용하고 있습니다', 10000)
    // 캡처 먼저 중지 → 녹음기에 남은 데이터 플러시
    if (IS_TAURI) {
      stopMicCapture()
    }
    stopSystemCapture()
    await stop()

    // 로컬 모드: 잔여 세그먼트 flush(마지막 발화) + 로컬 회의 종료 마킹 + opt-in 프로모트.
    if (activeSttMode === 'local') {
      await new Promise((r) => setTimeout(r, 250))
      await localStt.flush()
      if (localCtx.localId) {
        await localStore.setStatus(localCtx.localId, 'completed').catch(() => {})
        if (localUploadEnabled) {
          await syncFlushAll().catch(() => {})
        }
      }
    }
    try {
      // 요약함 선택 시에만 종료 전 미적용 기록 flush. 건너뛰기면 생략.
      if (!skipSummary) {
        await triggerRealtimeSummary(meetingId).catch(() => {})
        await new Promise((r) => setTimeout(r, 2000))
      }
      await stopMeeting(meetingId, { skipSummary })
      const summary = await getSummary(meetingId).catch(() => null)
      if (summary?.notes_markdown) {
        setMeetingNotes(summary.notes_markdown)
      }
      showStatus('회의가 종료되었습니다')
    } finally {
      setStatus('stopped')
      setMeetingApiStatus('completed')
      setIsStopping(false)
      setElapsedSeconds(0)
      elapsedBaseRef.current = null
    }
  }
```

- [ ] **Step 6: return 객체에 신규 항목 노출**

return 객체(line 639~)에 추가:
```ts
    handleManualSummary,
    canManualSummary: isActive && !isPaused && finalsCount > 0 && !isSummarizing,
    showStopConfirm,
    confirmStopSummarize,
    confirmStopSkip,
    cancelStop,
```

- [ ] **Step 7: 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/hooks/useLiveRecording.ts
git commit -m "feat(live): pause/resume API sync, manual summary, empty/stop guards"
```

---

## Task 10: 녹음 컨트롤에 "지금 요약" 버튼

**Files:**
- Modify: `frontend/src/components/meeting/DesktopRecordControls.tsx` (props + 버튼)
- Modify: `frontend/src/components/meeting/MobileRecordControls.tsx` (props + 버튼)

- [ ] **Step 1: DesktopRecordControls props 추가**

구조분해(line 35-37 부근)에 추가:
```ts
  onManualSummary,
  canManualSummary,
```
타입(line 63-65 부근)에 추가:
```ts
  onManualSummary: () => void
  canManualSummary: boolean
```

- [ ] **Step 2: DesktopRecordControls 버튼 렌더**

활성 상태 분기(line 248-267, `<>` … `</>`)에서 일시정지 버튼 앞에 "지금 요약" 추가:
```tsx
          <>
            <button
              onClick={onManualSummary}
              disabled={!canManualSummary}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              지금 요약
            </button>
            <button
              onClick={isPaused ? onResume : onPause}
```

- [ ] **Step 3: MobileRecordControls props + 버튼**

`MobileRecordControls.tsx` 구조분해(line 31-33 부근)에 `onManualSummary, canManualSummary` 추가, 타입(line 14-16 부근)에 `onManualSummary: () => void` / `canManualSummary: boolean` 추가. 일시정지/종료 버튼 그룹에 "지금 요약" 버튼 추가(기존 컨트롤 버튼과 동일 클래스 패턴):
```tsx
            <button
              onClick={onManualSummary}
              disabled={!canManualSummary}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-50 text-blue-700 disabled:opacity-40"
            >
              지금 요약
            </button>
```

> 정확한 삽입 위치는 해당 파일의 onPause 버튼 직전. 모바일 레이아웃 클래스는 인접 버튼과 맞춘다.

- [ ] **Step 4: 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — `MeetingLivePage`가 아직 `onManualSummary`/`canManualSummary`를 안 넘김(Task 11에서 해결). 컨트롤 파일 자체 문법 오류만 없으면 통과로 간주, Task 11 후 재확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/meeting/DesktopRecordControls.tsx frontend/src/components/meeting/MobileRecordControls.tsx
git commit -m "feat(meeting): add 지금 요약 button to record controls"
```

---

## Task 11: `MeetingLivePage` — 종료 다이얼로그 + 수동요약 배선

**Files:**
- Modify: `frontend/src/pages/MeetingLivePage.tsx` (구조분해 64-76, 컨트롤 props 237-264 / 349-358, 다이얼로그 493~)
- Test: `frontend/src/pages/MeetingLivePage.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/pages/MeetingLivePage.test.tsx`의 mock 보강 — `vi.mock('../api/meetings', ...)` 객체에 추가:
```ts
  pauseMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
  resumeMeeting: vi.fn().mockResolvedValue({ id: 1, status: 'recording' }),
```
파일 하단에 신규 테스트 추가(기존 describe 안 또는 신규 describe):
```tsx
import { stopMeeting } from '../api/meetings'

describe('회의 종료 — 최종요약 확인', () => {
  // (기존 테스트의 헬퍼/렌더 패턴을 따라 회의를 recording 상태로 만들고 종료 클릭)
  it('전사 있으면 다이얼로그 → "요약 없이 종료"는 skipSummary=true로 종료', async () => {
    // Arrange: transcriptStore에 finals 1건 주입 후 페이지를 recording 상태로 렌더
    // (이 테스트는 기존 LiveRecord/MeetingLivePage 테스트의 렌더 헬퍼를 재사용한다)
    // ...render & start...
    // Act
    fireEvent.click(await screen.findByRole('button', { name: '회의 종료' }))
    fireEvent.click(await screen.findByRole('button', { name: '요약 없이 종료' }))
    // Assert
    await waitFor(() => {
      expect(stopMeeting).toHaveBeenCalledWith(1, { skipSummary: true })
    })
  })
})
```

> 이 테스트는 기존 페이지 테스트의 렌더/상태 설정 헬퍼에 의존한다. 헬퍼가 transcriptStore에 finals를 주입하는 방법은 기존 테스트(예: `useTranscriptStore.setState({ finals: [...] })`)를 참고해 동일 패턴으로 작성한다. 만약 페이지 테스트에서 finals 주입이 번거로우면, **이 시나리오 테스트는 hook 단위로 대체**: `renderHook(() => useLiveRecording(...))` 후 store에 finals 세팅 → `handleStop()` 호출 → `showStopConfirm===true` → `confirmStopSkip()` → `stopMeeting` 호출 인자 검증.

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/pages/MeetingLivePage.test.tsx`
Expected: FAIL (다이얼로그 미배선).

- [ ] **Step 3: 구조분해에 신규 항목 추가**

`const { ... } = live` 구조분해(line 64-76)에 추가:
```ts
    handleManualSummary, canManualSummary,
    showStopConfirm, confirmStopSummarize, confirmStopSkip, cancelStop,
```

- [ ] **Step 4: 컨트롤에 props 전달**

`<DesktopRecordControls ...>`(line 237-264)와 `<MobileRecordControls ...>`(line 349-358) 각각에 추가:
```tsx
        onManualSummary={handleManualSummary}
        canManualSummary={canManualSummary}
```

- [ ] **Step 5: 종료 다이얼로그 렌더**

import에 추가(line 40 `ConfirmDialog` 부근):
```tsx
import { StopMeetingDialog } from '../components/meeting/StopMeetingDialog'
```
`showResetConfirm` 다이얼로그(line 493-502) 뒤에 추가:
```tsx
      {showStopConfirm && (
        <StopMeetingDialog
          onSummarize={confirmStopSummarize}
          onSkip={confirmStopSkip}
          onCancel={cancelStop}
        />
      )}
```

- [ ] **Step 6: 통과 확인**

Run:
```bash
cd frontend && npx tsc --noEmit && npx vitest run src/pages/MeetingLivePage.test.tsx
```
Expected: PASS (tsc 에러 없음 + 테스트 통과).

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/pages/MeetingLivePage.tsx frontend/src/pages/MeetingLivePage.test.tsx
git commit -m "feat(live): wire StopMeetingDialog and manual summary into MeetingLivePage"
```

---

## Task 12: 전체 검증

- [ ] **Step 1: 백엔드 전체 스펙**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb spec/jobs/`
Expected: PASS (0 failures).

- [ ] **Step 2: 프론트 타입 + 테스트**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 3: 프론트 빌드(메모리 `feedback_full_compile_verify`)**

Run: `cd frontend && npx vite build`
Expected: 빌드 성공.

- [ ] **Step 4: 수동 E2E 체크리스트 (dev 서버)**

- 회의 중 "지금 요약" 클릭 → 회의록 갱신, 전사 0이면 버튼 비활성.
- 일시정지 → 1분+ 대기 → 자동 요약 안 일어남(서버 로그 `paused`/cron 제외 확인). 재개 → 정상.
- 종료(전사 있음) → 다이얼로그 3선택. "요약 없이 종료" → final 요약/액션아이템 생성 안 됨, realtime 노트 유지.
- 종료(전사 0) → 다이얼로그 없이 즉시 종료.

---

## Self-Review (작성자 확인 완료)

- **Spec coverage:** 기능1=Task9/10/11, 기능2=Task3/8/9/11, 기능3=Task1/2/5/6/9, 기능4=Task3/4/9. 공유 paused_at=Task1/2. 전부 매핑됨.
- **이미 존재하던 가드**(final empty line187, realtime empty line102, 인터벌 isPaused 정지)는 중복 구현 안 함 — 명시.
- **기존 테스트 깨짐**: stop 스펙의 무조건 enqueue 단언 → Task3 Step1에서 전사 추가로 수정.
- **타입 일관성:** `stopMeeting(id, { skipSummary })`·`canManualSummary`·`handleManualSummary`·`showStopConfirm`/`confirmStopSummarize`/`confirmStopSkip`/`cancelStop` 명칭 Task9↔11 일치.
- **인가:** pause/resume를 `authorize_meeting_control!` only 목록에 포함(Task2 Step4) — viewer 차단.
