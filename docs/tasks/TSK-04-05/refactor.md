# TSK-04-05 리팩토링 보고서

## 검토 파일 목록

- `frontend/src/lib/summaryBlocks.ts`
- `frontend/src/hooks/useSummaryBlockInserter.ts`
- `frontend/src/channels/transcription.ts` (TSK-04-05 추가 부분)
- `frontend/src/stores/transcriptStore.ts` (TSK-04-05 추가 부분)
- `frontend/src/pages/MeetingLivePage.tsx` (TSK-04-05 추가 부분)

비교 참조 파일:
- `frontend/src/lib/transcriptBlocks.ts` (TSK-04-04)
- `frontend/src/hooks/useSttBlockInserter.ts` (TSK-04-04)

---

## 발견된 이슈 및 개선 사항

### 이슈 1: 타입 중복 - `SummaryData` vs `SummaryCompleteData`

**파일**: `summaryBlocks.ts`

`summaryBlocks.ts`에 정의된 `SummaryData` 인터페이스와 `transcription.ts`에 정의된 `SummaryCompleteData` 타입이 구조적으로 완전히 동일하다:

```
// transcription.ts
export type SummaryCompleteData = {
  key_points: string[]
  decisions: string[]
  action_items: Array<{ content: string; assignee_hint?: string; due_date_hint?: string }>
  discussion_details?: string[]
}

// summaryBlocks.ts (중복 정의)
export interface SummaryData {
  key_points: string[]
  decisions: string[]
  action_items: Array<{ content: string; assignee_hint?: string; due_date_hint?: string }>
  discussion_details?: string[]
}
```

동일한 도메인 타입을 두 곳에서 관리하면 향후 필드 추가/변경 시 두 곳을 동시에 수정해야 하는 유지보수 부담이 생긴다.

### 이슈 2: `useSummaryBlockInserter`의 이중 `useEffect`

**파일**: `useSummaryBlockInserter.ts`

reset 감지를 위해 별도의 `useEffect`를 사용했는데, 두 effect 모두 `finalSummary`를 구독한다. 하나의 effect 안에서 `null` 분기 처리로 통합하는 것이 가독성에 유리하다.

```typescript
// 기존: useEffect 2개 (null 체크용 + 삽입 로직용)
useEffect(() => {
  if (finalSummary === null) { insertedRef.current = false }
}, [finalSummary])

useEffect(() => {
  if (finalSummary === null) return
  // ...삽입 로직
}, [finalSummary, editorRef])
```

---

## 적용한 변경사항

### 변경 1: `SummaryData` 타입 중복 제거 (`summaryBlocks.ts`)

`SummaryData` 인터페이스 정의를 제거하고 `SummaryCompleteData`를 re-export하는 방식으로 변경했다. 기존 테스트 코드에서 `SummaryData`를 import하는 부분은 re-export 덕분에 변경 없이 동작한다.

```typescript
// 변경 전
export interface SummaryData { ... }

// 변경 후
import type { SummaryCompleteData } from '../channels/transcription'
export type { SummaryCompleteData as SummaryData }
```

내부 함수 시그니처도 `SummaryData` 대신 `SummaryCompleteData`를 직접 참조하도록 수정했다.

### 변경 2: 이중 `useEffect` 단일화 (`useSummaryBlockInserter.ts`)

두 개의 `useEffect`를 하나로 합쳐 `finalSummary === null` 분기를 단일 effect 안에서 처리하도록 변경했다.

```typescript
// 변경 후: useEffect 1개
useEffect(() => {
  if (finalSummary === null) {
    insertedRef.current = false
    return
  }
  if (insertedRef.current) return
  // ...삽입 로직
}, [finalSummary, editorRef])
```

---

## 리팩토링 후 테스트 결과

```
Test Files  25 passed (25)
      Tests 186 passed (186)
   Duration 3.09s
```

모든 테스트 통과.
