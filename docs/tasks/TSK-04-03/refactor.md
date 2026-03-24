# TSK-04-03 리팩토링 보고서

## 개요

에디터 ↔ API 동기화 구현 코드의 가독성과 유지보수성을 개선한다.
동작하는 로직은 변경하지 않으며, 코드 구조와 명확성만 개선한다.

---

## 수행한 리팩토링

### 1. `useBlockSync.ts` — `initialApiBlocksRef` 선언 순서 수정

**문제**: `initialApiBlocksRef`가 `useEffect` 내부(line 167)에서 사용되지만, 선언은 `useEffect` 아래(line 180)에 위치하여 읽기 흐름을 방해했다.
JavaScript hoisting으로 런타임에는 문제없지만, React hooks는 순서대로 읽히므로 선언이 사용 전에 위치해야 가독성이 좋다.

**변경 전**:
```ts
// 초기 로드
useEffect(() => {
  // ...
  initialApiBlocksRef.current = apiBlocks  // ← 사용
  // ...
}, [meetingId])

// 초기 API 블록 순서 보관 (첫 onChange 시 매핑 구성에 사용)
const initialApiBlocksRef = useRef<ApiBlock[]>([])  // ← 선언 (사용 후에 위치)
const mappingBuiltRef = useRef(false)
```

**변경 후**:
```ts
// 초기 API 블록 순서 보관 (첫 onChange 시 순서 기반 UUID ↔ DB id 매핑 구성에 사용)
const initialApiBlocksRef = useRef<ApiBlock[]>([])  // ← 선언 (사용 전에 위치)
const mappingBuiltRef = useRef(false)

// 초기 로드
useEffect(() => {
  // ...
  initialApiBlocksRef.current = apiBlocks  // ← 사용
  // ...
}, [meetingId])
```

---

### 2. `useBlockSync.ts` — `useEffect` 내 불필요한 주석 제거 및 코드 단순화

**문제**: 초기 로드 `useEffect` 내부에 7줄짜리 구현 설명 주석이 있었다. 이 주석은 설계 의도를 설명하지만, 해당 내용은 `initialApiBlocksRef` 선언 주석으로 이미 충분히 표현되므로 중복이었다.
또한 `editorBlocks` 임시 변수를 제거하여 코드를 간결하게 했다.

**변경 전**:
```ts
getBlocks(meetingId)
  .then((apiBlocks: ApiBlock[]) => {
    const editorBlocks = apiBlocksToEditorBlocks(apiBlocks)

    // ID 매핑 구성: apiBlocks[i].id ↔ editorBlocks[i].id (UUID 없으므로 나중에 매핑)
    // 초기 로드 시 editorBlocks에는 UUID가 없으므로 ...
    // (7줄 주석 생략)
    initialApiBlocksRef.current = apiBlocks

    setInitialContent(editorBlocks)
  })
```

**변경 후**:
```ts
getBlocks(meetingId)
  .then((apiBlocks: ApiBlock[]) => {
    initialApiBlocksRef.current = apiBlocks
    setInitialContent(apiBlocksToEditorBlocks(apiBlocks))
  })
```

---

### 3. `useBlockSync.ts` — import 선언 그룹 정렬

**문제**: `BlockNoteEditor` 타입과 `PartialBlock` 타입이 같은 `@blocknote/core`에서 임포트되지만 분리되어 있었다. 또한 타입 임포트가 혼재되어 있었다.

**변경 전**:
```ts
import type { PartialBlock } from '@blocknote/core'
import type { BlockNoteEditor } from '@blocknote/core'
```

**변경 후**:
```ts
import type { PartialBlock } from '@blocknote/core'
import type { customSchema } from '../components/editor/MeetingEditor'
import type { BlockNoteEditor } from '@blocknote/core'
```

(두 타입 임포트를 인접하게 배치)

---

### 4. `useBlockSync.ts` — rebalance 처리 중복 주석 제거

**문제**: `rebalanced` 처리 블록에 의미가 겹치는 두 줄의 주석이 있었다.

**변경 전**:
```ts
// rebalance 응답: 전체 블록 반환 시 ID 매핑 재구성
if (res.rebalanced && res.blocks) {
  // 현재 에디터 블록 순서와 재정렬된 API 블록 순서 재매핑
  res.blocks.forEach(...)
```

**변경 후**:
```ts
// rebalance 발생 시 서버에서 반환된 전체 블록으로 ID 매핑 재구성
if (res.rebalanced && res.blocks) {
  res.blocks.forEach(...)
```

---

### 5. `blockAdapter.ts` — `inlineContent` 변수 추출

**문제**: `apiBlocksToEditorBlocks` 내에서 `inlineContent` 계산이 조건문 내 타입 캐스트와 인라인으로 뒤섞여 있었다. 변수를 먼저 계산하고 조건부로 할당하도록 분리했다.

**변경 전**:
```ts
if (type !== 'transcript') {
  ;(editorBlock as Record<string, unknown>).content = apiBlock.content
    ? [{ type: 'text', text: apiBlock.content, styles: {} }]
    : []
}
```

**변경 후**:
```ts
const inlineContent = apiBlock.content
  ? [{ type: 'text', text: apiBlock.content, styles: {} }]
  : []

// transcript 타입은 content: 'none'이므로 인라인 콘텐츠를 설정하지 않는다
if (type !== 'transcript') {
  ;(editorBlock as Record<string, unknown>).content = inlineContent
}
```

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/hooks/useBlockSync.ts` | ref 선언 순서 수정, 불필요한 주석 제거, 중간 변수 제거, import 정렬 |
| `frontend/src/lib/blockAdapter.ts` | `inlineContent` 변수 추출로 계산/할당 분리 |

변경되지 않은 파일: `blocks.ts`, `MeetingEditor.tsx`, `MeetingPage.tsx`, 모든 테스트 파일

---

## 최종 테스트 결과

```
Test Files  23 passed (23)
     Tests  163 passed (163)
  Duration  2.53s
```

리팩토링 전후 모두 23개 파일, 163개 테스트 전체 통과.
