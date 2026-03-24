# TSK-04-04 리팩토링 리포트

## 검토 결과

### 검토한 파일 목록
- `frontend/src/lib/transcriptBlocks.ts`
- `frontend/src/hooks/useSttBlockInserter.ts`
- `frontend/src/components/editor/MeetingEditor.tsx`
- `frontend/src/pages/MeetingLivePage.tsx`

### 발견된 개선점

**`useSttBlockInserter.ts`**
- `finals` 배열 reset 감지를 위해 두 개의 `useEffect`가 분리되어 있었음
  - 첫 번째 effect: `[finals, editorRef]` 의존성으로 신규 블록 삽입 처리
  - 두 번째 effect: `[finals.length]` 의존성으로 `processedCountRef` 초기화
- 두 effect의 의존성 배열이 다르면 실행 순서 보장이 불명확하고, reset 로직을 한 곳에서 읽기 어려움
- reset 체크(`finals.length === 0`)를 첫 번째 effect 내부로 통합하여 단일 effect로 단순화 가능

**나머지 파일들** (`transcriptBlocks.ts`, `MeetingEditor.tsx`, `MeetingLivePage.tsx`)
- 코드 품질 양호, 변경 불필요

## 적용한 변경사항

### `frontend/src/hooks/useSttBlockInserter.ts`
- 두 개의 `useEffect`를 하나로 병합
- reset 처리(`finals.length === 0` → `processedCountRef.current = 0`) 로직을 삽입 effect 내부로 이동
- 불필요한 두 번째 effect 제거
- 동작은 동일하며, 코드 가독성 및 단순성 향상

## 테스트 결과
- 전체 테스트 통과: 21개 파일 / 123개 테스트 모두 통과 (변경 전후 동일)
