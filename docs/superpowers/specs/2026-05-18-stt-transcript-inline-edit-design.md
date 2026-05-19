# STT 자막 인라인 편집 (Transcript Inline Edit)

작성일: 2026-05-18

## 배경 / 목적

STT 결과가 잘못 잡힌 자막 한 줄을 사용자가 그 자리에서 빠르게 고칠 수 있도록 한다. 현재 자막은 표시만 가능하고, 수정하려면 전체 회의록 재생성이나 수동 회의록 편집을 거쳐야 한다.

대상 표시 영역 3곳:
- 라이브 기록 — `frontend/src/components/meeting/LiveRecord.tsx`
- 전체 기록 — `frontend/src/components/meeting/FullRecord.tsx`
- 회의 미리 보기 — `frontend/src/components/meeting/TranscriptPanel.tsx` (`MeetingViewerPage.tsx`에서 사용)

비대상: BlockNote 내부 `TranscriptBlock` (회의록에 임베드된 자막은 BlockNote가 직접 편집).

## 결정 사항 (요약)

- 수정 가능 필드: **`content` (텍스트)** 만. `speaker_label` / 시간은 손대지 않는다.
- 회의록 동기화: **자막만 수정**. 이미 회의록(`notes_markdown`)에 반영된 부분은 그대로 둔다 (사용자가 회의록을 직접 편집하거나 재생성 트리거).
- 인터랙션: 단일클릭은 기존 `onSeek`(오디오 위치 이동) 유지, **더블클릭으로 인라인 편집 진입**.
- 권한: 호스트와 시청자 모두 편집 가능.
- 실시간 동기화: ActionCable로 `transcript_updated` broadcast → 다른 탭/사용자에게 즉시 반영.

## 아키텍처

### 데이터 흐름

```
[더블클릭] → EditableTranscriptText 편집 모드
    → Enter/blur 저장
    → useTranscriptStore.updateFinal(id, draft)         // 낙관적 갱신
    → PATCH /api/v1/meetings/:id/transcripts/:tid       // content + client_id
        → Transcript#update! (content)
        → Meeting#update!(last_user_edit_at: now)       // 요약 잡 가드 트리거
        → ActionCable broadcast { type: "transcript_updated", id, content, client_id }
    → 다른 클라이언트: channels/transcription.ts 핸들러
        → client_id가 자기 것이면 drop (echo)
        → 아니면 useTranscriptStore.updateFinal(id, content)
```

### 단일 소유권

- `transcripts` 테이블 row가 권위(authoritative).
- 사용자 편집은 즉시 row를 갱신하고 `Meeting#last_user_edit_at`을 함께 갱신하여 `MeetingSummarizationJob`의 기존 stale 가드(`stale_relative_to_user_action?`)가 자동으로 자막 편집을 인지하도록 한다.
- 자기 PATCH의 broadcast echo는 `client_id`로 무시한다.

## 컴포넌트 / 변경 파일

### Backend

#### `config/routes.rb`
`resources :transcripts`의 member에 `patch :update_content` 추가.

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

#### `app/controllers/api/v1/transcripts_controller.rb`
`update_content` 액션 추가.

- 입력: `{ content: string, client_id?: string }`
- 검증:
  - `content` 공백 제거 후 비어있으면 422.
  - 길이 상한 5000자 초과 시 422.
- 권한: 기존 `MeetingLookup` 흐름 사용 (host + viewer 모두 통과).
- 동작:
  1. `transcript = @meeting.transcripts.find(params[:id])`
  2. `transcript.update!(content: params[:content])`
  3. `@meeting.update!(last_user_edit_at: Time.current)` — 진행/예약 중인 요약 잡 가드 트리거.
  4. `ActionCable.server.broadcast(@meeting.transcription_stream, { type: "transcript_updated", id: transcript.id, content: transcript.content, client_id: params[:client_id] })`
  5. 응답: `{ transcript: transcript_json(transcript) }`

#### FTS 인덱스
`Transcript` 모델은 `FtsIndexable` 컨선을 통해 `transcripts_fts` 가상 테이블에 동기화된다. ActiveRecord 콜백으로 자동 갱신되는 패턴이면 추가 작업 없음. 구현 단계에서 동작 확인 후, 자동 동기화가 아니면 update 후 명시적 reindex 호출 한 줄 추가.

### Frontend

#### `src/api/meetings.ts`
`updateTranscript` 함수 추가.

```ts
export async function updateTranscript(
  meetingId: number,
  transcriptId: number,
  content: string,
  clientId?: string,
): Promise<Transcript> {
  const res: { transcript: Transcript } = await apiClient
    .patch(`meetings/${meetingId}/transcripts/${transcriptId}`,
           { json: { content, client_id: clientId } })
    .json()
  return res.transcript
}
```

#### `src/stores/transcriptStore.ts`
`updateFinal(id, content)` 액션 추가. `finals` 배열에서 id가 일치하는 항목의 `content`만 교체. 정렬, `appliedIds`, `applied` 플래그 보존. 일치 항목 없으면 no-op (이미 삭제된 경우).

#### `src/channels/transcription.ts`
- 타입 정의에 `transcript_updated` 케이스 추가.
- 핸들러: `data.client_id === useTranscriptStore.getState().clientId`이면 drop (echo). 아니면 `updateFinal(data.id, data.content)`.
- reset 가드와의 정합성: `lastResetAt`이 broadcast 도착 직전이면 drop (기존 `meeting_notes_update` 패턴 따름).

#### `src/components/meeting/EditableTranscriptText.tsx` (신규)
재사용 가능한 작은 컴포넌트. 3개 표시 영역이 공통으로 사용.

Props:
```ts
interface Props {
  transcriptId: number
  meetingId: number
  content: string          // 외부 권위 (store)
  editable: boolean        // false면 그냥 텍스트
  className?: string
}
```

내부 상태:
- `isEditing: boolean` — 더블클릭으로 진입.
- `draft: string` — 편집 중 로컬 버퍼.
- `saving: boolean` — 저장 중 dim.

상호작용:
- `onDoubleClick`: `e.stopPropagation()`로 상위 onSeek 방지. `editable && !isEditing`이면 편집 진입.
- 편집 모드 렌더: `<span contentEditable suppressContentEditableWarning>` (textarea 아닌 contentEditable로 원래 텍스트 레이아웃 유지).
  - mount 시 focus + 전체 선택.
  - `onKeyDown`:
    - `Enter` (Shift 없음) → 저장.
    - `Shift+Enter` → 줄바꿈 허용.
    - `Esc` → 취소.
  - `onBlur` → 저장.
  - `onPaste` → `e.preventDefault()` + `document.execCommand('insertText', false, text)`로 plain-text 강제.
- 저장 흐름:
  1. `draft.trim()`이 빈 문자열이면 취소 처리.
  2. `draft === content`이면 그냥 종료 (API 호출 없음).
  3. 낙관적 갱신: `useTranscriptStore.getState().updateFinal(transcriptId, draft)`.
  4. `updateTranscript(meetingId, transcriptId, draft, clientId)` 호출.
  5. 실패 시 store를 `prevContent`로 롤백 + inline 에러 표시(2초 후 자동 해제).
- 시각 표시:
  - 편집 중: 좌측 보더 강조 (`border-l-2 border-blue-500`).
  - 저장 중: `opacity-60`.

#### 통합 지점

- `LiveRecord.tsx` (L91 부근): 기존 `<p>{item.content}</p>`를 `<EditableTranscriptText editable transcriptId={item.id} meetingId={meetingId} content={item.content} />`로 교체. `meetingId`를 prop으로 추가.
- `FullRecord.tsx` (L107 부근): 동일. `meetingId`는 이미 prop으로 받고 있음.
- `TranscriptPanel.tsx` (L62 부근): 동일. `meetingId`를 prop으로 추가하여 `MeetingViewerPage.tsx`에서 전달.

기존 상위 컨테이너의 단일클릭 `onSeek`는 유지. 더블클릭은 `stopPropagation`으로 onSeek를 타지 않음.

비대상: `TranscriptBlock.tsx` (BlockNote 임베드 블록은 BlockNote가 직접 편집).

## 엣지 케이스

- **삭제된 자막**: 다른 사용자가 동시에 `destroy_batch`로 삭제하여 404 응답 → 응답 처리에서 store의 해당 id 제거 + 안내 toast.
- **partial → final 승격 중 편집**: partial은 별도 항목으로 store `finals`에 없는 id이므로 편집 대상이 아니다. `finals[]`만 편집 가능.
- **applied=true 자막 편집**: 회의록은 안 건드린다는 정책에 따라 자막만 수정한다. `applied_to_minutes` 플래그는 유지.
- **reset 직후 broadcast**: 기존 `lastResetAt` 가드 패턴을 `transcript_updated`에도 동일 적용.
- **동시 편집(여러 사용자가 같은 자막 수정)**: last-write-wins. 두 번째 PATCH가 첫 번째를 덮어쓴다. broadcast로 양쪽 모두 최종 상태로 수렴.
- **편집 중 broadcast 도착**: 자기 client_id가 아니고 자기 자막이면 화면이 갑자기 바뀔 수 있음. 단순화 정책: 편집 모드에서는 `transcript_updated`를 store에 반영하되 현재 `draft`는 그대로 유지 (저장 시 사용자가 마지막 권위). 실용상 동시 편집은 드물어 추가 충돌 처리 안 함.

## 요약 잡과의 정합성

`MeetingSummarizationJob`은 다음 가드를 이미 갖고 있다:
- `limits_concurrency` (SolidQueue, prod)
- in-process `MEETING_LOCKS` Mutex (dev/`:async`)
- `stale_relative_to_user_action?` — `meeting.last_user_edit_at > enqueued_at`이면 skip (LLM 호출 전/후 두 번 검사)

본 기능은 controller에서 `meeting.last_user_edit_at`을 갱신하는 한 줄로 위 가드가 자동 작동한다. 추가 가드 코드 없음.

## 테스트

### Backend (rspec)
- `spec/requests/api/v1/transcripts_spec.rb` 확장:
  - update_content 정상 (200, content 반영, broadcast).
  - 빈 content / 길이 상한 초과 / 다른 회의의 transcript id → 4xx.
  - `meeting.last_user_edit_at` 갱신 확인.
- `spec/jobs/meeting_summarization_job_spec.rb`:
  - 자막 편집 직후 enqueue된 realtime job이 stale 가드로 skip되는 회귀.

### Frontend (vitest)
- `EditableTranscriptText` 단위 테스트:
  - 더블클릭 → 편집 진입, 외부 onSeek 호출 안 됨 (`stopPropagation`).
  - Enter → 저장 API 호출 + store 갱신.
  - Shift+Enter → 줄바꿈 허용 (저장 안 일어남).
  - Esc → 취소, API 호출 없음, store 원본 유지.
  - blur → 저장.
  - 변경 없음 / 공백만 → API 호출 없음.
  - paste plain-text 강제.
  - API 실패 → store 롤백 + 에러 표시.
- `transcriptStore.test.ts`:
  - `updateFinal`이 정렬·`appliedIds`·`applied` 플래그 보존.
- `channels/transcription` 테스트:
  - 자기 client_id echo drop.
  - 타 client_id 반영.
  - lastResetAt 가드.
- 기존 `LiveRecord` / `FullRecord` / `TranscriptPanel` 테스트 회귀:
  - 단일클릭 onSeek 보존.
  - 더블클릭은 onSeek 안 탐.

## 범위 밖 (별도 작업)

- Mermaid 다이어그램 크기 문제 (`mermaidBlock.tsx`의 `min-w-[480px]` + Mermaid 인라인 max-width 정리) — 별도 PR.
- 자막 편집 기록 audit log / 되돌리기.
- 회의록 안의 transcript 인용 자동 동기화.
- 화자 라벨 / 시간 편집.
