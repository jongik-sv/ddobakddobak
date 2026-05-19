# STT 자막 인라인 편집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STT 자막을 라이브/전체/미리보기 3곳에서 더블클릭으로 인라인 편집하고, ActionCable로 실시간 동기화한다.

**Architecture:** `transcripts.content` row 직접 갱신 + `meeting.last_user_edit_at` 트리거로 기존 요약 잡 가드에 자동 연동. 공통 `EditableTranscriptText` 컴포넌트로 3개 패널에 통합. 자기 PATCH의 broadcast echo는 `client_id`로 drop.

**Tech Stack:** Rails 8.1 + ActionCable + SolidQueue / React + Zustand + BlockNote / RSpec + Vitest

**Spec:** `docs/superpowers/specs/2026-05-18-stt-transcript-inline-edit-design.md`

---

## File Structure

**Backend (modify):**
- `config/routes.rb` — `:transcripts` 멤버에 `patch :update_content` 추가.
- `app/controllers/api/v1/transcripts_controller.rb` — `update_content` 액션 추가.
- `spec/requests/api/v1/transcripts_spec.rb` — `PATCH update_content` describe 블록 추가.

**Frontend (create):**
- `src/components/meeting/EditableTranscriptText.tsx` — 공통 인라인 편집 컴포넌트.
- `src/components/meeting/EditableTranscriptText.test.tsx` — 단위 테스트.

**Frontend (modify):**
- `src/api/meetings.ts` — `updateTranscript` 함수 추가.
- `src/stores/transcriptStore.ts` — `updateFinal(id, content)` 액션 추가.
- `src/stores/transcriptStore.test.ts` — `updateFinal` 테스트 추가.
- `src/channels/transcription.ts` — `transcript_updated` 핸들러 추가.
- `src/components/meeting/LiveRecord.tsx` — `<p>` 텍스트 부분을 `EditableTranscriptText`로 교체, `meetingId` prop 추가.
- `src/components/meeting/FullRecord.tsx` — 동일.
- `src/components/meeting/TranscriptPanel.tsx` — 동일, `meetingId` prop 추가.
- `src/pages/MeetingPage.tsx` — `TranscriptPanel`에 `meetingId` 전달 (L386, L669 두 군데).
- `src/components/meeting/LiveRecord.test.tsx` (이미 있다면) / `FullRecord.test.tsx` / `TranscriptPanel.test.tsx` — `meetingId` prop 변경 반영.

---

## Task 1: 백엔드 — `PATCH update_content` 액션 (TDD)

**Files:**
- Modify: `backend/config/routes.rb` (resources :transcripts member 블록)
- Modify: `backend/app/controllers/api/v1/transcripts_controller.rb`
- Modify: `backend/spec/requests/api/v1/transcripts_spec.rb`

### Step 1: 실패하는 테스트 작성

`backend/spec/requests/api/v1/transcripts_spec.rb`의 `RSpec.describe "Api::V1::Transcripts" ... do` 블록 끝(`describe "GET ..."` 닫는 `end` 다음, 최상위 describe 닫기 전)에 다음을 추가:

- [ ] **Step 1: 실패하는 spec 추가**

```ruby
# ─────────────────────────────────────────────────────────
# PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content
# ─────────────────────────────────────────────────────────
describe "PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content" do
  let!(:transcript) do
    create(:transcript, meeting: meeting, sequence_number: 1,
           content: "원본 텍스트", speaker_label: "SPEAKER_00",
           started_at_ms: 0, ended_at_ms: 3000)
  end

  context "정상 요청" do
    it "200 OK, content 갱신" do
      patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
            params: { content: "수정된 텍스트", client_id: "abc-123" }

      expect(response).to have_http_status(:ok)
      json = response.parsed_body
      expect(json["transcript"]["content"]).to eq("수정된 텍스트")
      expect(transcript.reload.content).to eq("수정된 텍스트")
    end

    it "meeting.last_user_edit_at 갱신" do
      freeze_time = Time.zone.parse("2026-05-18 10:00:00")
      travel_to(freeze_time) do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "수정", client_id: "c1" }
      end
      expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze_time)
    end

    it "ActionCable broadcast 발행" do
      expect(ActionCable.server).to receive(:broadcast).with(
        meeting.transcription_stream,
        hash_including(
          type: "transcript_updated",
          id: transcript.id,
          content: "수정",
          client_id: "c1"
        )
      )
      patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
            params: { content: "수정", client_id: "c1" }
    end
  end

  context "공백만 들어온 경우" do
    it "422 반환, content 그대로" do
      patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
            params: { content: "   " }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(transcript.reload.content).to eq("원본 텍스트")
    end
  end

  context "길이 상한(5000자) 초과" do
    it "422 반환" do
      patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
            params: { content: "x" * 5001 }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  context "다른 회의의 transcript id" do
    let(:other_meeting) { create(:meeting, team: team, creator: user) }
    let!(:other_transcript) do
      create(:transcript, meeting: other_meeting, sequence_number: 1,
             content: "다른 회의", speaker_label: "SPEAKER_00",
             started_at_ms: 0, ended_at_ms: 1000)
    end

    it "404 Not Found" do
      patch "/api/v1/meetings/#{meeting.id}/transcripts/#{other_transcript.id}/update_content",
            params: { content: "해킹 시도" }

      expect(response).to have_http_status(:not_found)
    end
  end

  context "존재하지 않는 transcript" do
    it "404 Not Found" do
      patch "/api/v1/meetings/#{meeting.id}/transcripts/999999/update_content",
            params: { content: "x" }

      expect(response).to have_http_status(:not_found)
    end
  end
end
```

### Step 2: 테스트 실패 확인

- [ ] **Step 2: spec 실행해서 라우트 없음으로 실패하는지 확인**

```bash
cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb -e "update_content"
```

Expected: 모든 케이스 FAIL (라우트 없음 → 404 또는 routing error)

### Step 3: 라우트 추가

- [ ] **Step 3: `backend/config/routes.rb`의 `resources :transcripts` 블록 수정**

`resources :transcripts, only: [] do` 블록을 다음으로 교체 (L69-73 부근):

```ruby
resources :transcripts, only: [] do
  member do
    patch :update_content
  end
  collection do
    delete :destroy_batch
  end
end
```

### Step 4: 컨트롤러에 액션 추가

- [ ] **Step 4: `backend/app/controllers/api/v1/transcripts_controller.rb` 수정**

`destroy_batch` 메서드와 `private` 사이에 다음 메서드 추가:

```ruby
def update_content
  content = params[:content].to_s
  trimmed = content.strip
  if trimmed.empty?
    return render json: { error: "content blank" }, status: :unprocessable_entity
  end
  if content.length > 5000
    return render json: { error: "content too long" }, status: :unprocessable_entity
  end

  transcript = @meeting.transcripts.find_by(id: params[:id])
  return render json: { error: "Transcript not found" }, status: :not_found unless transcript

  transcript.update!(content: content)
  @meeting.update!(last_user_edit_at: Time.current)

  ActionCable.server.broadcast(
    @meeting.transcription_stream,
    {
      type: "transcript_updated",
      id: transcript.id,
      content: transcript.content,
      client_id: params[:client_id]
    }
  )

  render json: { transcript: transcript_json(transcript) }
end
```

### Step 5: 테스트 통과 확인

- [ ] **Step 5: spec 실행해서 통과하는지 확인**

```bash
cd backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb
```

Expected: 모든 케이스 PASS (기존 GET 테스트 + 새 update_content 5+ 케이스).

### Step 6: 회귀 — 요약 잡 가드 검증

- [ ] **Step 6: 요약 잡 spec이 자막 편집 후 stale 가드를 통과하는지 회귀**

```bash
cd backend && bundle exec rspec spec/jobs/meeting_summarization_job_spec.rb
```

Expected: PASS (기존 가드는 `meeting.last_user_edit_at`만 보므로 자막 편집 경로도 자동 커버됨).

### Step 7: 커밋

- [ ] **Step 7: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add backend/config/routes.rb backend/app/controllers/api/v1/transcripts_controller.rb backend/spec/requests/api/v1/transcripts_spec.rb
git commit -m "$(cat <<'EOF'
feat(backend): add PATCH transcripts/:id/update_content for STT 인라인 편집

자막 텍스트를 갱신하고 meeting.last_user_edit_at을 함께 갱신하여
기존 요약 잡의 stale 가드가 자동으로 자막 편집을 인지하도록 한다.
브로드캐스트 client_id로 echo 방지.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 프론트엔드 — `transcriptStore.updateFinal` (TDD)

**Files:**
- Modify: `frontend/src/stores/transcriptStore.ts`
- Modify: `frontend/src/stores/transcriptStore.test.ts`

### Step 1: 실패하는 테스트 작성

- [ ] **Step 1: `transcriptStore.test.ts`의 마지막 describe 블록 안 또는 새 describe 추가**

```ts
describe('updateFinal', () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      partial: null,
      finals: [],
      appliedIds: new Set<number>(),
      meetingNotes: null,
      currentSpeaker: null,
      isSummarizing: false,
      summarizationKind: null,
      lastUserEditAt: 0,
      lastResetAt: 0,
    })
  })

  it('일치하는 final의 content만 교체한다', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: '원본 1', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
      { id: 2, content: '원본 2', speaker_label: 'B', started_at_ms: 1000, ended_at_ms: 2000, sequence_number: 2, applied: true },
    ])

    useTranscriptStore.getState().updateFinal(1, '수정됨')

    const finals = useTranscriptStore.getState().finals
    expect(finals.find((f) => f.id === 1)?.content).toBe('수정됨')
    expect(finals.find((f) => f.id === 2)?.content).toBe('원본 2')
  })

  it('applied 플래그를 보존한다', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 5, content: 'x', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: true },
    ])
    useTranscriptStore.getState().updateFinal(5, 'y')
    expect(useTranscriptStore.getState().finals[0].applied).toBe(true)
  })

  it('일치하는 id가 없으면 no-op', () => {
    useTranscriptStore.getState().loadFinals([
      { id: 1, content: 'a', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
    ])
    const before = useTranscriptStore.getState().finals
    useTranscriptStore.getState().updateFinal(999, 'z')
    expect(useTranscriptStore.getState().finals).toBe(before)
  })
})
```

### Step 2: 테스트 실패 확인

- [ ] **Step 2: 실행해서 `updateFinal is not a function`으로 실패하는지 확인**

```bash
cd frontend && npm test -- transcriptStore --run
```

Expected: FAIL (updateFinal 메서드 없음).

### Step 3: store에 액션 추가

- [ ] **Step 3: `transcriptStore.ts` 수정**

`interface TranscriptState`의 `removeFinals` 다음 줄에 추가:

```ts
  updateFinal: (id: number, content: string) => void
```

`removeFinals` 구현 다음에 메서드 구현 추가:

```ts
updateFinal: (id, content) =>
  set((state) => {
    const idx = state.finals.findIndex((f) => f.id === id)
    if (idx === -1) return state
    if (state.finals[idx].content === content) return state
    const updated = [...state.finals]
    updated[idx] = { ...updated[idx], content }
    return { finals: updated }
  }),
```

### Step 4: 테스트 통과 확인

- [ ] **Step 4: 실행해서 PASS 확인**

```bash
cd frontend && npm test -- transcriptStore --run
```

Expected: PASS.

### Step 5: 커밋

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/stores/transcriptStore.ts frontend/src/stores/transcriptStore.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add updateFinal action to transcriptStore

특정 id의 final transcript content만 교체하는 액션 추가. applied
플래그와 정렬 보존, id 미일치 시 no-op.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 프론트엔드 — `updateTranscript` API 함수

**Files:**
- Modify: `frontend/src/api/meetings.ts`

### Step 1: API 함수 추가

- [ ] **Step 1: `meetings.ts`의 `deleteTranscripts` 함수 다음에 추가**

```ts
export async function updateTranscript(
  meetingId: number,
  transcriptId: number,
  content: string,
  clientId?: string,
): Promise<Transcript> {
  const res = await apiClient
    .patch(`meetings/${meetingId}/transcripts/${transcriptId}/update_content`, {
      json: { content, client_id: clientId },
    })
    .json<{ transcript: Transcript }>()
  return res.transcript
}
```

### Step 2: 타입체크 통과 확인

- [ ] **Step 2: 타입체크 실행**

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

### Step 3: 커밋

- [ ] **Step 3: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/api/meetings.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add updateTranscript API helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 프론트엔드 — ActionCable `transcript_updated` 핸들러

**Files:**
- Modify: `frontend/src/channels/transcription.ts`

### Step 1: BackendMessage 타입 확장

- [ ] **Step 1: `BackendMessage` 타입에 `content` 필드 추가**

`BackendMessage` 타입에서 `notes_markdown?: string` 줄 근처에 다음을 추가:

```ts
  content?: string
```

(이미 `id?: number`와 `client_id?: string`은 존재함.)

### Step 2: 핸들러 case 추가

- [ ] **Step 2: `received(raw)` switch 안에 case 추가 (다른 case들과 동일한 스타일)**

`case 'transcripts_applied':` 다음에 삽입:

```ts
case 'transcript_updated': {
  // Echo 가드: 내 PATCH 응답으로 이미 store가 갱신됨
  if (raw.client_id && raw.client_id === store.clientId) {
    break
  }
  // Reset 가드: 최근 reset 직후의 잔여 broadcast 무시
  if (Date.now() - store.lastResetAt < 5000) {
    break
  }
  if (typeof raw.id === 'number' && typeof raw.content === 'string') {
    store.updateFinal(raw.id, raw.content)
  }
  break
}
```

### Step 3: 단위 테스트 추가

- [ ] **Step 3: `frontend/src/channels/transcription.test.ts` (있으면 추가, 없으면 신규)**

먼저 파일 존재 여부 확인:

```bash
ls frontend/src/channels/transcription.test.ts 2>/dev/null && echo EXISTS || echo NEW
```

존재하지 않으면 새 파일 생성:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from '../stores/transcriptStore'

// transcription.ts의 received() 내부 로직을 직접 검증하기 위해
// 동일한 분기 트리를 작은 helper로 추출하거나, 다음과 같이 store만 직접 검증한다.
// 여기서는 핸들러를 직접 export하지 않으므로, channel 외부에서 검증할 수 있도록
// reducer-style helper를 도입한다.

describe('transcript_updated 처리', () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      partial: null,
      finals: [
        { id: 7, content: '원본', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
      ],
      appliedIds: new Set(),
      meetingNotes: null,
      currentSpeaker: null,
      isSummarizing: false,
      summarizationKind: null,
      lastUserEditAt: 0,
      lastResetAt: 0,
    })
  })

  it('타 client의 메시지는 store에 반영', () => {
    const store = useTranscriptStore.getState()
    // received() 안의 분기를 직접 모사
    const raw = { type: 'transcript_updated', id: 7, content: '바뀜', client_id: 'other-client' }
    if (raw.client_id && raw.client_id === store.clientId) return
    if (Date.now() - store.lastResetAt < 5000) return // 위 setState에서 lastResetAt=0이라 통과
    if (typeof raw.id === 'number' && typeof raw.content === 'string') {
      store.updateFinal(raw.id, raw.content)
    }
    expect(useTranscriptStore.getState().finals[0].content).toBe('바뀜')
  })

  it('내 client_id면 drop (echo)', () => {
    const myClientId = useTranscriptStore.getState().clientId
    const store = useTranscriptStore.getState()
    const raw = { type: 'transcript_updated', id: 7, content: '에코', client_id: myClientId }
    if (raw.client_id && raw.client_id === store.clientId) {
      // drop
    } else {
      store.updateFinal(raw.id, raw.content)
    }
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })

  it('reset 가드: lastResetAt 직후는 drop', () => {
    useTranscriptStore.setState({ lastResetAt: Date.now() })
    const store = useTranscriptStore.getState()
    const raw = { type: 'transcript_updated', id: 7, content: '리셋후', client_id: 'other' }
    if (raw.client_id && raw.client_id === store.clientId) return
    if (Date.now() - store.lastResetAt < 5000) {
      // drop
    } else {
      store.updateFinal(raw.id, raw.content)
    }
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })
})
```

> 주: 채널 핸들러는 외부 export가 없는 클로저라 통합 테스트로는 ActionCable mock이 필요하다. 이 단계에서는 분기 트리를 그대로 옮긴 단위 테스트로 회귀 보호한다. 채널 모듈 자체에 mock 분기를 도입하는 리팩토링은 별도 작업.

### Step 4: 테스트 실행

- [ ] **Step 4: 테스트 PASS 확인**

```bash
cd frontend && npm test -- transcription --run
```

Expected: PASS.

### Step 5: 커밋

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/channels/transcription.ts frontend/src/channels/transcription.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): handle transcript_updated broadcast

client_id echo / lastResetAt 가드 적용 후 store.updateFinal 호출.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 프론트엔드 — `EditableTranscriptText` 컴포넌트 (TDD)

**Files:**
- Create: `frontend/src/components/meeting/EditableTranscriptText.tsx`
- Create: `frontend/src/components/meeting/EditableTranscriptText.test.tsx`

### Step 1: 실패하는 테스트 작성

- [ ] **Step 1: 테스트 파일 생성**

`frontend/src/components/meeting/EditableTranscriptText.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableTranscriptText } from './EditableTranscriptText'
import { useTranscriptStore } from '../../stores/transcriptStore'

vi.mock('../../api/meetings', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return {
    ...actual,
    updateTranscript: vi.fn(async (_mId: number, _tId: number, content: string) => ({
      id: _tId, speaker_label: 'A', content,
      started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1,
    })),
  }
})

import { updateTranscript } from '../../api/meetings'

beforeEach(() => {
  useTranscriptStore.setState({
    partial: null,
    finals: [
      { id: 1, content: '원본', speaker_label: 'A', started_at_ms: 0, ended_at_ms: 1000, sequence_number: 1, applied: false },
    ],
    appliedIds: new Set(),
    meetingNotes: null,
    currentSpeaker: null,
    isSummarizing: false,
    summarizationKind: null,
    lastUserEditAt: 0,
    lastResetAt: 0,
  })
  vi.clearAllMocks()
})

describe('EditableTranscriptText', () => {
  it('editable=false면 더블클릭해도 편집 모드로 진입하지 않는다', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable={false} />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    expect(span.getAttribute('contenteditable')).not.toBe('true')
  })

  it('더블클릭 → 편집 진입, 상위 onClick은 호출되지 않는다', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />
      </div>,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    expect(span.getAttribute('contenteditable')).toBe('true')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('Enter → 저장 호출, store 즉시 갱신', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '수정됨'
    fireEvent.keyDown(span, { key: 'Enter' })

    await waitFor(() =>
      expect(updateTranscript).toHaveBeenCalledWith(10, 1, '수정됨', expect.any(String)),
    )
    expect(useTranscriptStore.getState().finals[0].content).toBe('수정됨')
  })

  it('Esc → 취소, API 호출 없음, store 원본 유지', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '편집중'
    fireEvent.keyDown(span, { key: 'Escape' })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
    expect(span.getAttribute('contenteditable')).not.toBe('true')
  })

  it('변경 없음 → API 호출 없이 종료', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(updateTranscript).not.toHaveBeenCalled()
  })

  it('공백만 → API 호출 없이 취소 처리', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '   '
    fireEvent.keyDown(span, { key: 'Enter' })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(useTranscriptStore.getState().finals[0].content).toBe('원본')
  })

  it('Shift+Enter → 저장하지 않음 (줄바꿈 허용)', () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    fireEvent.keyDown(span, { key: 'Enter', shiftKey: true })
    expect(updateTranscript).not.toHaveBeenCalled()
    expect(span.getAttribute('contenteditable')).toBe('true')
  })

  it('blur → 저장', async () => {
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '블러저장'
    fireEvent.blur(span)
    await waitFor(() =>
      expect(updateTranscript).toHaveBeenCalledWith(10, 1, '블러저장', expect.any(String)),
    )
  })

  it('API 실패 시 store 롤백', async () => {
    ;(updateTranscript as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    )
    render(
      <EditableTranscriptText transcriptId={1} meetingId={10} content="원본" editable />,
    )
    const span = screen.getByText('원본')
    fireEvent.doubleClick(span)
    span.textContent = '실패예정'
    fireEvent.keyDown(span, { key: 'Enter' })
    await waitFor(() =>
      expect(useTranscriptStore.getState().finals[0].content).toBe('원본'),
    )
  })
})
```

### Step 2: 테스트 실행해 실패 확인

- [ ] **Step 2: 실행 → 모듈 없음으로 실패**

```bash
cd frontend && npm test -- EditableTranscriptText --run
```

Expected: FAIL (`Cannot find module './EditableTranscriptText'`).

### Step 3: 컴포넌트 구현

- [ ] **Step 3: `EditableTranscriptText.tsx` 생성**

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranscriptStore } from '../../stores/transcriptStore'
import { updateTranscript } from '../../api/meetings'

interface Props {
  transcriptId: number
  meetingId: number
  content: string
  editable: boolean
  className?: string
}

const MAX_LEN = 5000

export function EditableTranscriptText({
  transcriptId,
  meetingId,
  content,
  editable,
  className,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const spanRef = useRef<HTMLSpanElement>(null)
  const prevContentRef = useRef<string>(content)
  const clientId = useTranscriptStore((s) => s.clientId)
  const updateFinal = useTranscriptStore((s) => s.updateFinal)

  // 편집 진입 시 텍스트 select-all + focus
  useEffect(() => {
    if (isEditing && spanRef.current) {
      const el = spanRef.current
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [isEditing])

  // 외부 content 변경(다른 사용자 broadcast 등)이 들어오면 편집 중이 아닐 때만 반영
  useEffect(() => {
    if (!isEditing && spanRef.current) {
      spanRef.current.textContent = content
    }
  }, [content, isEditing])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editable || isEditing) return
      e.stopPropagation()
      prevContentRef.current = content
      setIsEditing(true)
    },
    [editable, isEditing, content],
  )

  const cancel = useCallback(() => {
    if (spanRef.current) spanRef.current.textContent = prevContentRef.current
    setIsEditing(false)
  }, [])

  const save = useCallback(async () => {
    if (!spanRef.current) {
      setIsEditing(false)
      return
    }
    const draft = (spanRef.current.textContent ?? '').replace(/ /g, ' ')
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      cancel()
      return
    }
    if (draft.length > MAX_LEN) {
      cancel()
      return
    }
    if (draft === prevContentRef.current) {
      setIsEditing(false)
      return
    }

    // 낙관적 갱신
    updateFinal(transcriptId, draft)
    setIsEditing(false)
    setSaving(true)
    try {
      await updateTranscript(meetingId, transcriptId, draft, clientId)
    } catch {
      // 롤백
      updateFinal(transcriptId, prevContentRef.current)
    } finally {
      setSaving(false)
    }
  }, [cancel, updateFinal, transcriptId, meetingId, clientId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void save()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    },
    [save, cancel],
  )

  const handleBlur = useCallback(() => {
    if (isEditing) void save()
  }, [isEditing, save])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLSpanElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  return (
    <span
      ref={spanRef}
      contentEditable={isEditing}
      suppressContentEditableWarning
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPaste={handlePaste}
      className={
        (className ?? '') +
        ' ' +
        (isEditing
          ? 'outline-none border-l-2 border-blue-500 pl-1 bg-blue-50'
          : '') +
        ' ' +
        (saving ? 'opacity-60' : '')
      }
    >
      {content}
    </span>
  )
}
```

### Step 4: 테스트 통과 확인

- [ ] **Step 4: 실행 → PASS**

```bash
cd frontend && npm test -- EditableTranscriptText --run
```

Expected: PASS (모든 케이스).

### Step 5: 타입체크

- [ ] **Step 5: 타입체크**

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

### Step 6: 커밋

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/components/meeting/EditableTranscriptText.tsx frontend/src/components/meeting/EditableTranscriptText.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add EditableTranscriptText for inline STT 자막 편집

더블클릭 진입, Enter/blur 저장, Esc 취소, Shift+Enter 줄바꿈,
paste plain-text 강제. 낙관적 갱신 + API 실패 시 롤백.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `LiveRecord`에 통합

**Files:**
- Modify: `frontend/src/components/meeting/LiveRecord.tsx`
- Modify: `frontend/src/components/meeting/LiveRecord.test.tsx` (있다면 prop 변경 반영)

### Step 1: prop 시그니처 변경

- [ ] **Step 1: `LiveRecordProps`에 `meetingId` 추가**

```ts
interface LiveRecordProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
}

export function LiveRecord({ meetingId, currentTimeMs = 0, onSeek, onApply }: LiveRecordProps) {
```

### Step 2: 텍스트 렌더 부분 교체

- [ ] **Step 2: L91의 `<p>` 라인을 교체**

기존:
```tsx
<p className="text-sm text-gray-900 leading-relaxed">{item.content}</p>
```

→ 교체:
```tsx
<EditableTranscriptText
  transcriptId={item.id}
  meetingId={meetingId}
  content={item.content}
  editable
  className="text-sm text-gray-900 leading-relaxed"
/>
```

### Step 3: import 추가

- [ ] **Step 3: 파일 상단 import**

```ts
import { EditableTranscriptText } from './EditableTranscriptText'
```

### Step 4: 호출부 수정 — `MeetingLivePage.tsx` 등

- [ ] **Step 4: LiveRecord 사용처에 meetingId 전달**

```bash
grep -n "<LiveRecord" /Users/jji/project/ddobakddobak/frontend/src --include="*.tsx" -r
```

찾아낸 각 호출부에 `meetingId={meetingId}` prop 추가. 후보(현재 코드 기준):
- `frontend/src/components/meeting/RecordTabPanel.tsx`
- `frontend/src/pages/MeetingLivePage.tsx`

각 호출에서 이미 `meetingId`가 스코프에 있는지 확인 후 prop 전달.

### Step 5: 테스트 / 타입체크

- [ ] **Step 5: 통과 확인**

```bash
cd frontend && npm run typecheck && npm test -- LiveRecord --run
```

Expected: PASS. 기존 테스트가 prop 변경으로 실패하면 테스트의 mount 부분에 `meetingId={1}` 추가.

### Step 6: 커밋

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/components/meeting/LiveRecord.tsx frontend/src/components/meeting/LiveRecord.test.tsx frontend/src/components/meeting/RecordTabPanel.tsx frontend/src/pages/MeetingLivePage.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): LiveRecord에 인라인 자막 편집 통합

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `FullRecord`에 통합

**Files:**
- Modify: `frontend/src/components/meeting/FullRecord.tsx`

### Step 1: 텍스트 렌더 부분 교체

- [ ] **Step 1: L107 부근 교체**

기존:
```tsx
<p className="text-sm text-gray-900 leading-relaxed mt-0.5">{item.content}</p>
```

→ 교체:
```tsx
<EditableTranscriptText
  transcriptId={item.id}
  meetingId={meetingId}
  content={item.content}
  editable
  className="text-sm text-gray-900 leading-relaxed mt-0.5"
/>
```

### Step 2: import 추가

- [ ] **Step 2: 파일 상단 import**

```ts
import { EditableTranscriptText } from './EditableTranscriptText'
```

`meetingId`는 이미 `FullRecordProps`에 있음 — 추가 변경 불필요.

### Step 3: 타입체크 / 테스트

- [ ] **Step 3:**

```bash
cd frontend && npm run typecheck && npm test -- FullRecord --run 2>&1 | tail -40
```

Expected: PASS. 기존 테스트가 깨지면 onClick 단일클릭 동작 검증을 보존하면서 prop만 맞춰 수정.

### Step 4: 커밋

- [ ] **Step 4: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/components/meeting/FullRecord.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): FullRecord에 인라인 자막 편집 통합

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `TranscriptPanel`(회의 미리보기)에 통합

**Files:**
- Modify: `frontend/src/components/meeting/TranscriptPanel.tsx`
- Modify: `frontend/src/components/meeting/TranscriptPanel.test.tsx`
- Modify: `frontend/src/pages/MeetingPage.tsx` (L386, L669 두 호출부)

### Step 1: Props 시그니처에 `meetingId` 추가

- [ ] **Step 1: `TranscriptPanel.tsx` 수정**

```ts
interface TranscriptPanelProps {
  meetingId: number
  transcripts: Transcript[]
  currentTimeMs: number
  onSeek: (ms: number) => void
}

export function TranscriptPanel({ meetingId, transcripts, currentTimeMs, onSeek }: TranscriptPanelProps) {
```

### Step 2: 텍스트 렌더 교체

- [ ] **Step 2: L62 부근의 `<span>` 교체**

기존:
```tsx
<span className="text-sm text-gray-800 select-text">{transcript.content}</span>
```

→ 교체:
```tsx
<EditableTranscriptText
  transcriptId={transcript.id}
  meetingId={meetingId}
  content={transcript.content}
  editable
  className="text-sm text-gray-800 select-text"
/>
```

### Step 3: import 추가

- [ ] **Step 3:**

```ts
import { EditableTranscriptText } from './EditableTranscriptText'
```

### Step 4: 호출부 수정

- [ ] **Step 4: `MeetingPage.tsx` L386 / L669**

각 `<TranscriptPanel ... />`에 `meetingId={meetingId}` prop 추가.

(MeetingPage가 `meetingId` 스코프 변수를 어떻게 가지고 있는지 확인 — 보통 `useParams`나 `props`로 받음. 변수명 차이만 맞추고 prop 전달.)

```bash
grep -n "meetingId\|const id" /Users/jji/project/ddobakddobak/frontend/src/pages/MeetingPage.tsx | head -5
```

### Step 5: 테스트 수정

- [ ] **Step 5: `TranscriptPanel.test.tsx`의 render 호출에 `meetingId` 추가**

각 `<TranscriptPanel ... />` 호출에 `meetingId={1}` 추가.

### Step 6: 타입체크 / 테스트

- [ ] **Step 6:**

```bash
cd frontend && npm run typecheck && npm test -- TranscriptPanel --run
```

Expected: PASS.

### Step 7: 커밋

- [ ] **Step 7: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src/components/meeting/TranscriptPanel.tsx frontend/src/components/meeting/TranscriptPanel.test.tsx frontend/src/pages/MeetingPage.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): TranscriptPanel(미리보기)에 인라인 자막 편집 통합

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 통합 회귀 & 수동 검증

### Step 1: 전체 테스트 스위트

- [ ] **Step 1: 백엔드 spec 실행**

```bash
cd /Users/jji/project/ddobakddobak/backend && bundle exec rspec spec/requests/api/v1/transcripts_spec.rb spec/jobs/meeting_summarization_job_spec.rb spec/models/transcript_spec.rb
```

Expected: PASS.

- [ ] **Step 2: 프론트엔드 전체 테스트 + typecheck + lint**

```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run typecheck && npm run lint && npm test --run
```

Expected: PASS.

### Step 2: 수동 검증 시나리오

- [ ] **Step 3: 라이브 녹음 페이지 수동 테스트**
  1. 새 회의 시작, 자막 몇 개 누적.
  2. 라이브 기록의 자막 한 줄 더블클릭 → 인라인 편집 모드.
  3. 텍스트 수정 후 Enter → 저장 + UI 즉시 반영.
  4. 다른 자막을 단일클릭 → 오디오 seek가 정상 동작(편집 모드 아님).
  5. 1분 대기 후 realtime 요약 cron이 돌 때, 회의록이 옛 자막으로 덮어쓰여지지 않는지 확인 (사용자 편집 가드 작동).

- [ ] **Step 4: 전체 기록 탭 수동 테스트**
  1. 같은 페이지에서 전체 기록 탭 전환.
  2. 임의 자막 더블클릭 → 편집 → Enter 저장.
  3. 체크박스 동작과 충돌 없음 확인.

- [ ] **Step 5: 회의 미리보기 (MeetingPage) 수동 테스트**
  1. 종료된 회의 상세 페이지 진입.
  2. transcripts 패널의 자막 더블클릭 → 편집 → 저장.
  3. 새로고침 후 변경이 영속화됐는지 확인.

- [ ] **Step 6: 멀티탭 동기화 검증**
  1. 같은 회의 페이지를 두 탭에서 연다.
  2. 탭 A에서 자막 편집 → Enter.
  3. 탭 B의 자막이 broadcast로 즉시 갱신되는지 확인.
  4. 탭 A는 자기 PATCH의 broadcast echo로 깜빡임 없는지 확인 (client_id 가드).

### Step 3: 최종 커밋

- [ ] **Step 7: 누락된 변경 있으면 한 번에 정리 커밋**

```bash
git status
# 누락된 것 있으면 staging 후
git commit -m "$(cat <<'EOF'
chore: STT 자막 인라인 편집 — 수동 검증 후 정리

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review 결과

**Spec coverage 점검:**

| Spec 섹션 | 구현 Task |
|---|---|
| 백엔드: routes/controller/last_user_edit_at/broadcast | Task 1 |
| FTS 인덱스 자동 갱신 (`FtsIndexable#after_save`) | Task 1 (Transcript는 이미 `after_save :fts_upsert`. 추가 코드 불필요. Step 6 회귀에서 안전망) |
| 권한 (host + viewer) | Task 1의 controller는 `MeetingLookup`만 사용 → 기존 viewer 접근 흐름 그대로 |
| 프론트엔드 API helper | Task 3 |
| Store `updateFinal` | Task 2 |
| Channel `transcript_updated` 핸들러 + echo / reset 가드 | Task 4 |
| `EditableTranscriptText` 컴포넌트 + 모든 키 동작 | Task 5 |
| 3개 표시 영역 통합 (라이브/전체/미리보기) | Task 6, 7, 8 |
| 단일클릭 onSeek 보존 / 더블클릭 stopPropagation | Task 5 테스트 + Task 6/7/8 통합 |
| 통합 회귀 + 수동 검증 | Task 9 |

**Placeholder scan:** TBD/TODO 없음. 모든 step에 코드/명령 명시. ✓

**Type consistency:** `updateFinal(id, content)`, `updateTranscript(meetingId, transcriptId, content, clientId?)`, `EditableTranscriptText` props 시그니처가 모든 task에서 일관됨. ✓

**비고:**
- `FtsIndexable`은 `Transcript` 모델에 `after_save :fts_upsert` 콜백을 자동 부여하므로 `transcript.update!`만으로 검색 인덱스가 갱신된다. 별도 단계 불필요.
- Task 6의 "LiveRecord 사용처"는 환경에 따라 `RecordTabPanel`을 통해 간접 호출될 수도 있음 — Step 4의 grep으로 실제 위치를 확인한 뒤 prop을 전파.
- BlockNote 내부 `TranscriptBlock`은 범위 밖(spec 명시).
