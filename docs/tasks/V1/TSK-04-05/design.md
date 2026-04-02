# TSK-04-05: AI 요약 블록 자동 삽입 - 설계 문서

## 1. 개요 및 목적

회의 종료 후 서버에서 생성된 AI 최종 요약(key_points, decisions, action_items, discussion_details)을 프론트엔드 BlockNote 에디터에 구조화된 블록 형태로 자동 삽입한다. 삽입된 블록은 일반 블록과 동일하게 수동 편집 가능하며, useBlockSync를 통해 서버와 동기화된다.

### 요구사항 정리

| 항목 | 내용 |
|------|------|
| 트리거 | 회의 종료(stop) → MeetingFinalizerService 완료 → 프론트엔드 수신 |
| 삽입 위치 | 에디터 상단 (기존 블록들 위) |
| 블록 구조 | 핵심 요약(H2) + bullet list / 결정사항(H2) + bullet list / Action Items(H2) + checkbox list |
| 편집 가능 여부 | 삽입 후 일반 BlockNote 블록과 동일하게 편집 가능 |
| 데이터 출처 | GET /api/v1/meetings/:id/summary (TSK-05-02에서 생성) |

---

## 2. 아키텍처 설계

### 2.1 전체 데이터 흐름

```
[회의 종료 클릭]
     |
     v
MeetingLivePage.handleStop()
  -> stopMeeting(meetingId)        # POST /api/v1/meetings/:id/stop
  -> status = 'stopped'
     |
     v (서버에서 비동기 처리 - TSK-05-02)
MeetingFinalizerService (Rails)
  -> POST sidecar /summarize
  -> Summary 레코드 저장
  -> ActionCable 브로드캐스트: { type: "summary_complete", summary: {...} }
     |
     v (프론트엔드 WebSocket 수신)
transcription.ts createTranscriptionChannel()
  -> case 'summary_complete': store.setFinalSummary(data)
     |
     v
useSummaryBlockInserter(editorRef)  [신규 훅]
  -> finalSummary 변경 감지
  -> summaryToBlocks(finalSummary)  [신규 변환 함수]
  -> editor.insertBlocks(blocks, firstBlock, 'before')
  -> useBlockSync.onEditorChange() 트리거 → API 저장
```

### 2.2 컴포넌트 구조

```
MeetingLivePage (기존)
├── useSttBlockInserter(editorRef)         [기존 - STT 블록 삽입]
├── useSummaryBlockInserter(editorRef)     [신규 - 요약 블록 삽입]
├── useTranscription(meetingId)            [기존]
└── MeetingEditor(editorRef)              [기존]

MeetingPage (기존 - 회의 완료 후 뷰)
└── useBlockSync(meetingId, editorRef)     [기존 - 이미 저장된 블록 로드]
    (summary 블록은 이미 DB에 있으므로 별도 처리 불필요)
```

### 2.3 신규 파일 목록

| 파일 | 역할 |
|------|------|
| `frontend/src/lib/summaryBlocks.ts` | Summary 데이터 → BlockNote 블록 변환 함수 |
| `frontend/src/hooks/useSummaryBlockInserter.ts` | summary_complete 이벤트 감지 → 에디터 상단에 삽입 |
| `frontend/src/lib/summaryBlocks.test.ts` | summaryToBlocks 단위 테스트 |
| `frontend/src/hooks/useSummaryBlockInserter.test.ts` | useSummaryBlockInserter 단위 테스트 |

### 2.4 기존 파일 변경 목록

| 파일 | 변경 내용 |
|------|----------|
| `frontend/src/channels/transcription.ts` | `summary_complete` 이벤트 타입 추가 |
| `frontend/src/stores/transcriptStore.ts` | `finalSummary` 상태 및 `setFinalSummary` 액션 추가 |
| `frontend/src/api/meetings.ts` | `getSummary(meetingId)` 함수 추가 (폴링 폴백용) |
| `frontend/src/pages/MeetingLivePage.tsx` | `useSummaryBlockInserter(editorRef)` 호출 추가 |

---

## 3. 상세 구현 계획

### 3.1 `frontend/src/lib/summaryBlocks.ts` (신규)

```typescript
// 입력 타입 (TSK-05-02 브로드캐스트 데이터 형식)
export interface SummaryData {
  key_points: string[]
  decisions: string[]
  action_items: Array<{
    content: string
    assignee_hint?: string
    due_date_hint?: string
  }>
  discussion_details?: string[]
}

// 출력: BlockNote PartialBlock 배열
export function summaryToBlocks(summary: SummaryData): PartialBlock[]
```

**생성 블록 구조 (에디터 상단 삽입 순서):**

```
[heading2]  "AI 요약"              ← 구분선 역할 헤딩
[heading3]  "핵심 요약"
[bulletListItem]  key_points[0]
[bulletListItem]  key_points[1]
...
[heading3]  "결정사항"
[bulletListItem]  decisions[0]
...
[heading3]  "Action Items"
[checkListItem]   action_items[0].content  (assignee/due_date 포함 텍스트)
...
```

action_item 텍스트 포맷: `"content (@assignee_hint, 마감: due_date_hint)"` — assignee_hint/due_date_hint가 없으면 괄호 부분 생략.

빈 배열 섹션(예: decisions가 비어있으면)은 헤딩 + 빈 bullet 1개 대신 섹션 전체를 생략한다.

### 3.2 `frontend/src/hooks/useSummaryBlockInserter.ts` (신규)

```typescript
// useSttBlockInserter와 유사한 패턴
export function useSummaryBlockInserter(editorRef: RefObject<any | null>): void
```

**동작 로직:**

1. `useTranscriptStore(s => s.finalSummary)` 구독
2. `finalSummary`가 null → 아무것도 하지 않음
3. `insertedRef.current === true` → 중복 삽입 방지 (회의당 1회만)
4. `finalSummary` 수신 시:
   - `summaryToBlocks(finalSummary)` 호출
   - `editor.document`의 첫 번째 블록 앞에 삽입: `editor.insertBlocks(blocks, firstBlock, 'before')`
   - `insertedRef.current = true` 설정

### 3.3 `frontend/src/channels/transcription.ts` 변경

```typescript
// 신규 이벤트 타입 추가
export type SummaryCompleteData = {
  key_points: string[]
  decisions: string[]
  action_items: Array<{
    content: string
    assignee_hint?: string
    due_date_hint?: string
  }>
  discussion_details?: string[]
}

// TranscriptionEvent union에 추가
| { type: 'summary_complete'; data: SummaryCompleteData }

// received() switch에 추가
case 'summary_complete':
  store.setFinalSummary(raw.data)
  break
```

### 3.4 `frontend/src/stores/transcriptStore.ts` 변경

```typescript
// 상태 추가
finalSummary: SummaryCompleteData | null

// 액션 추가
setFinalSummary: (data: SummaryCompleteData) => void

// reset()에 finalSummary: null 포함
```

### 3.5 `frontend/src/api/meetings.ts` 변경

```typescript
// 회의 완료 후 summary 조회 (MeetingPage에서 사용, 폴백 폴링용)
export interface SummaryResponse {
  id: number
  meeting_id: number
  key_points: string      // JSON string (Rails 저장 형식)
  decisions: string       // JSON string
  discussion_details: string
  summary_type: 'realtime' | 'final'
  generated_at: string
}

export async function getSummary(meetingId: number): Promise<SummaryResponse | null>
```

### 3.6 `frontend/src/pages/MeetingLivePage.tsx` 변경

```typescript
// 기존 useSttBlockInserter 호출 아래에 추가
import { useSummaryBlockInserter } from '../hooks/useSummaryBlockInserter'
// ...
useSttBlockInserter(editorRef)
useSummaryBlockInserter(editorRef)  // 추가
```

---

## 4. API 설계

### 4.1 ActionCable 이벤트 (서버 → 클라이언트)

TSK-05-02(SummarizationJob)에서 브로드캐스트하는 이벤트 스펙:

```json
{
  "type": "summary_complete",
  "data": {
    "key_points": ["분기 매출 목표 15% 성장 논의", "마케팅 예산 증액 검토"],
    "decisions": ["Q2 목표: 전분기 대비 15% 성장으로 확정"],
    "action_items": [
      {
        "content": "마케팅 예산 안 작성",
        "assignee_hint": "화자2",
        "due_date_hint": "2026-04-01"
      }
    ],
    "discussion_details": ["분기 매출 목표에 대한 상세 논의"]
  }
}
```

### 4.2 REST API (폴백용)

기존 블록 API를 그대로 활용한다. 요약 블록은 `useSummaryBlockInserter`가 editor에 삽입한 뒤 `useBlockSync`의 `onEditorChange`가 트리거되면서 자동으로 `/api/v1/meetings/:id/blocks` POST 요청으로 저장된다.

MeetingPage (회의 완료 후 뷰)에서는 이미 DB에 저장된 블록이 `getBlocks()`로 로드되므로 별도 처리 불필요.

폴백 시나리오 (WebSocket 미수신): 페이지 재방문 시 `GET /api/v1/meetings/:id/summary`로 summary를 조회하여 아직 삽입되지 않은 경우 수동 삽입 버튼 제공 (선택적 구현).

---

## 5. 블록 타입 매핑

| 섹션 | BlockNote 타입 | API block_type |
|------|---------------|----------------|
| 헤딩 "AI 요약" | `heading` (level: 2) | `heading2` |
| 섹션 헤딩 | `heading` (level: 3) | `heading3` |
| 핵심 요약 항목 | `bulletListItem` | `bullet_list` |
| 결정사항 항목 | `bulletListItem` | `bullet_list` |
| Action Item | `checkListItem` | `checkbox` |

모두 기존 `blockAdapter.ts`의 `BN_TO_API_TYPE`, `API_TO_BN_TYPE` 매핑에 이미 정의되어 있으므로 추가 변경 없이 저장 가능하다.

---

## 6. 테스트 계획

### 6.1 단위 테스트: `summaryBlocks.test.ts`

| 케이스 | 검증 내용 |
|--------|----------|
| 전체 섹션 존재 | H2 AI요약, H3 핵심요약+항목, H3 결정사항+항목, H3 ActionItems+체크박스 생성 |
| key_points 빈 배열 | 핵심 요약 섹션 전체 생략 |
| decisions 빈 배열 | 결정사항 섹션 전체 생략 |
| action_items 빈 배열 | Action Items 섹션 전체 생략 |
| assignee_hint 없음 | content만 표시, 괄호 없음 |
| assignee_hint + due_date_hint | "내용 (@화자2, 마감: 2026-04-01)" |
| assignee_hint만 있음 | "내용 (@화자2)" |

### 6.2 단위 테스트: `useSummaryBlockInserter.test.ts`

| 케이스 | 검증 내용 |
|--------|----------|
| finalSummary null | insertBlocks 미호출 |
| finalSummary 수신 | insertBlocks 1회 호출, 첫 블록 앞에 삽입 |
| finalSummary 중복 수신 | insertBlocks 1회만 호출 (중복 방지) |
| editorRef null | 에러 없이 처리 |
| 에디터 비어있는 경우 | 빈 document 처리 (첫 블록 없는 경우) |

### 6.3 통합 시나리오

| 시나리오 | 검증 내용 |
|---------|----------|
| 회의 시작 → STT 블록 삽입 → 회의 종료 → 요약 블록 상단 삽입 | 요약 블록이 STT 블록들 위에 배치 |
| 요약 블록 삽입 후 수동 편집 | 텍스트 변경 → useBlockSync → API PATCH |
| MeetingPage 재방문 | getBlocks()로 요약 포함 전체 블록 정상 로드 |

---

## 7. 구현 순서

1. **`lib/summaryBlocks.ts` 구현 및 테스트** — 가장 핵심 변환 로직, 의존성 없음
2. **`stores/transcriptStore.ts` 변경** — `finalSummary` 상태 추가
3. **`channels/transcription.ts` 변경** — `summary_complete` 이벤트 처리 추가
4. **`hooks/useSummaryBlockInserter.ts` 구현 및 테스트**
5. **`pages/MeetingLivePage.tsx` 변경** — 훅 호출 추가
6. **`api/meetings.ts` 변경** — `getSummary()` 추가 (폴백 대비)
7. **E2E 시나리오 수동 검증**

---

## 8. 주요 설계 결정 사항

### 8.1 삽입 방식: 에디터 API vs API 직접 호출

에디터 `insertBlocks()` → `onEditorChange()` → useBlockSync API 저장 경로를 선택.

이유: useSttBlockInserter(TSK-04-04)와 동일한 패턴 유지, BlockNote 내부 상태와 DB 상태 자동 동기화, 코드 일관성.

### 8.2 중복 삽입 방지

`insertedRef`(useRef)로 회의 생애주기 동안 1회만 삽입 보장. `finalSummary`가 store reset 시 null로 돌아가므로 다음 회의 시작 시 자연스럽게 초기화.

### 8.3 빈 에디터 처리

`editor.document`가 빈 배열인 경우 BlockNote는 내부적으로 빈 paragraph 블록을 보유한다. 이 경우 첫 블록 앞에 삽입하는 방식으로 처리. 만약 document가 실제로 비어있을 경우 `editor.insertBlocks(blocks, undefined, 'end')` 등 BlockNote API의 fallback 처리 필요.

### 8.4 MeetingPage에서 별도 처리 불필요

회의 종료 → 요약 블록 → useBlockSync가 DB 저장 → MeetingPage 재방문 시 `getBlocks()`가 모든 블록(요약 포함)을 로드. 별도 summary 렌더링 로직 불필요.
