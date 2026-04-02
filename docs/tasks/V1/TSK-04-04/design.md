# TSK-04-04: STT 텍스트 → 블록 자동 구성 - 설계

## 구현 방향

`transcriptStore`의 `finals` 배열에 쌓이는 `TranscriptFinalData`를 감시하여, 새로운 final 항목이 추가될 때마다 BlockNote 에디터에 `transcript` 타입 블록을 자동 삽입한다. `MeetingEditor`를 ref 기반으로 에디터 인스턴스를 외부에 노출하도록 수정하고, `useSttBlockInserter` 훅이 store 구독 → 에디터 삽입 로직을 담당한다. `MeetingLivePage`에서 에디터 ref와 훅을 연결하면, STT final 이벤트가 발생할 때마다 화자 라벨이 포함된 `transcript` 블록이 에디터 끝에 자동으로 추가된다.

회의가 종료된 후 서버에서 전체 트랜스크립트를 불러올 때도 동일한 블록 형식(`transcript` 타입, `speakerLabel`/`text` props)을 사용한다. 이를 위해 API 응답을 BlockNote 블록 배열로 변환하는 순수 함수 `transcriptsToBlocks`를 `lib/transcriptBlocks.ts`에 분리하여, 실시간 삽입과 초기 로드 두 경로가 동일한 변환 로직을 공유하도록 한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `frontend/src/lib/transcriptBlocks.ts` | `TranscriptFinalData` → BlockNote transcript 블록 변환 순수 함수 | 신규 |
| `frontend/src/lib/transcriptBlocks.test.ts` | 변환 함수 단위 테스트 | 신규 |
| `frontend/src/hooks/useSttBlockInserter.ts` | transcriptStore 구독 → 에디터 블록 자동 삽입 훅 | 신규 |
| `frontend/src/hooks/useSttBlockInserter.test.ts` | 삽입 훅 단위 테스트 | 신규 |
| `frontend/src/components/editor/MeetingEditor.tsx` | `editorRef` prop 추가로 외부에서 editor 인스턴스 접근 가능하도록 수정 | 수정 |
| `frontend/src/components/editor/MeetingEditor.test.tsx` | editorRef 노출 테스트 추가 | 수정 |
| `frontend/src/pages/MeetingLivePage.tsx` | `editorRef` 생성 + `useSttBlockInserter` 연결, 메모 textarea를 `MeetingEditor`로 교체 | 수정 |

## 주요 구조

### `transcriptBlocks.ts`

```ts
import type { TranscriptFinalData } from '../channels/transcription'

export type TranscriptBlockInsert = {
  type: 'transcript'
  props: { speakerLabel: string; text: string }
}

export function finalToBlock(data: TranscriptFinalData): TranscriptBlockInsert {
  return {
    type: 'transcript',
    props: { speakerLabel: data.speaker_label, text: data.content },
  }
}

export function transcriptsToBlocks(finals: TranscriptFinalData[]): TranscriptBlockInsert[] {
  return finals.map(finalToBlock)
}
```

### `useSttBlockInserter.ts`

BlockNote editor 인스턴스(`BlockNoteEditor`)를 ref로 받아, `useTranscriptStore`의 `finals` 배열 길이를 구독한다. 컴포넌트 마운트 시 이미 쌓인 finals를 일괄 삽입(초기 동기화)하고, 이후 새로운 항목이 추가될 때마다 증분 삽입한다.

```ts
export function useSttBlockInserter(
  editorRef: React.RefObject<BlockNoteEditor<...> | null>
): void
```

- `processedCountRef`로 마지막으로 처리한 finals 인덱스를 추적하여 중복 삽입 방지
- `editor.insertBlocks([newBlock], lastBlock, 'after')` 패턴으로 문서 끝에 추가
- 에디터가 준비되지 않은 경우(`editorRef.current === null`) 삽입 스킵

### `MeetingEditor.tsx` 수정

`useImperativeHandle` 대신 `editorRef` prop(`React.RefObject<BlockNoteEditor>`)을 직접 받아 `useEffect` 내에서 `editorRef.current = editor`로 할당. 컴포넌트 언마운트 시 `editorRef.current = null` 정리.

```ts
interface MeetingEditorProps {
  initialContent?: CustomBlock[]
  onChange?: (blocks: CustomBlock[]) => void
  editable?: boolean
  editorRef?: React.RefObject<BlockNoteEditor<typeof customSchema.blockSpecs> | null>
}
```

### `MeetingLivePage.tsx` 수정

- `useRef<BlockNoteEditor<...> | null>(null)` 생성 후 `MeetingEditor`에 전달
- `useSttBlockInserter(editorRef)` 호출
- 기존 `<textarea>` 메모 영역을 `<MeetingEditor editorRef={editorRef} />` 로 교체

## 데이터 흐름

```
[Python Sidecar] STT final 완료
        ↓
[ActionCable] TranscriptionChannel → received({ type: 'final', data })
        ↓
[transcription.ts] store.addFinal(data)
        ↓
[transcriptStore] finals 배열에 TranscriptFinalData 추가
        ↓
[useSttBlockInserter] finals 구독 → 새 항목 감지 (processedCountRef 비교)
        ↓
[transcriptBlocks.ts] finalToBlock(data) → TranscriptBlockInsert
        ↓
[BlockNoteEditor] editor.insertBlocks([block], lastBlock, 'after')
        ↓
[MeetingEditor / BlockNoteView] 화자 라벨 + 텍스트가 포함된 transcript 블록 렌더링
```

**회의 종료 후 전문 복원 흐름:**

```
[stopMeeting API] 회의 종료
        ↓
[MeetingLivePage] transcriptStore.reset() 후 페이지 이동 OR 에디터 재마운트
        ↓ (별도 로드 시)
[API] GET /api/v1/meetings/:id/transcripts → TranscriptFinalData[]
        ↓
[transcriptsToBlocks()] 전체 배열 변환
        ↓
[MeetingEditor initialContent] 변환된 블록 배열로 에디터 초기화
```

## 선행 조건

- TSK-04-01 완료: `MeetingEditor`, `TranscriptBlock`, `customSchema` 구현 완료
- TSK-03-02 완료: `transcriptStore.finals`, `TranscriptFinalData` 타입, `useTranscription` 훅 구현 완료
- `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine` 패키지 설치 완료 (`package.json` 확인 필요)

## 테스트 전략 (Vitest)

### `transcriptBlocks.test.ts`
- `finalToBlock` - `TranscriptFinalData` 입력 → `speakerLabel`, `text` props가 올바르게 매핑되는지 검증
- `transcriptsToBlocks` - 빈 배열 입력 시 빈 배열 반환, 복수 항목 순서 보존 검증
- `speaker_label` 값이 그대로 `speakerLabel` prop에 전달되는지 검증

### `useSttBlockInserter.test.ts`
- 훅 마운트 시 이미 존재하는 `finals` 항목이 에디터에 삽입되는지 검증 (초기 동기화)
- 훅 마운트 후 `addFinal` 호출 시 신규 블록 1개만 추가되는지 검증 (증분 삽입)
- `editorRef.current === null`인 경우 `insertBlocks`가 호출되지 않는지 검증
- 동일 final이 두 번 삽입되지 않는지 검증 (중복 방지)
- `transcriptStore.reset()` 후 `processedCountRef`가 초기화되는지 검증

### `MeetingEditor.test.tsx` 추가
- `editorRef` prop 전달 시 `editorRef.current`에 editor 인스턴스가 할당되는지 검증
- 컴포넌트 언마운트 시 `editorRef.current`가 `null`로 정리되는지 검증
