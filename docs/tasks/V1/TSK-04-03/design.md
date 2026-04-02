# TSK-04-03: 에디터 ↔ API 동기화 - 설계 문서

## 1. 구현 개요

BlockNote 에디터와 Rails 블록 CRUD API(TSK-04-02) 간의 양방향 동기화를 구현한다.

### 핵심 흐름

```
[초기 로드]
MeetingPage 마운트
  → GET /api/v1/meetings/:id/blocks
  → API 블록 배열을 BlockNote 포맷으로 변환
  → MeetingEditor의 initialContent로 전달

[변경 감지 → 저장]
사용자 편집 (입력/삭제/이동)
  → MeetingEditor onChange 콜백
  → useBlockSync: diff 계산 (이전 블록 상태와 비교)
  → 디바운스 (800ms)
  → API에 변경 사항만 PATCH/POST/DELETE 전송
```

### 설계 원칙

- **diff 기반 최소 API 호출**: 전체 블록을 매번 저장하지 않고, 이전 스냅샷과 비교해 변경된 블록만 API로 전송
- **디바운스 800ms**: 타이핑 중 과도한 API 요청 방지
- **낙관적 업데이트 없음 (MVP)**: 저장 실패 시 에러 토스트만 표시, 롤백 없음 (Phase 2)
- **블록 ID 매핑**: BlockNote 내부 UUID ↔ 서버 DB id 매핑 관리

---

## 2. 파일 구조

### 생성할 파일

```
frontend/src/
  api/
    blocks.ts                     # 블록 CRUD API 함수 (신규)
  hooks/
    useBlockSync.ts               # 에디터 ↔ API 동기화 훅 (신규)
    useBlockSync.test.ts          # 훅 단위 테스트 (신규)
  lib/
    blockAdapter.ts               # BlockNote ↔ API 블록 포맷 변환 (신규)
    blockAdapter.test.ts          # 변환 유틸 단위 테스트 (신규)
```

### 수정할 파일

```
frontend/src/
  components/editor/
    MeetingEditor.tsx             # initialContent prop 처리 보강 (기존 파일 수정)
  pages/
    MeetingPage.tsx               # 블록 초기 로드 + useBlockSync 연결 (기존 파일 수정)
```

---

## 3. 핵심 구현 내용

### 3.1 API 클라이언트: `frontend/src/api/blocks.ts`

TSK-04-02 설계의 API 엔드포인트를 그대로 호출하는 함수들.

```typescript
export interface ApiBlock {
  id: number
  meeting_id: number
  block_type: string
  content: string
  position: number
  parent_block_id: number | null
  created_at: string
  updated_at: string
}

export interface ReorderResponse {
  block: ApiBlock
  rebalanced: boolean
  blocks?: ApiBlock[]
}

// GET /api/v1/meetings/:meeting_id/blocks
export async function getBlocks(meetingId: number): Promise<ApiBlock[]>

// POST /api/v1/meetings/:meeting_id/blocks
export async function createBlock(
  meetingId: number,
  payload: { block_type: string; content: string; position: number; parent_block_id: number | null }
): Promise<ApiBlock>

// PATCH /api/v1/meetings/:meeting_id/blocks/:id
export async function updateBlock(
  meetingId: number,
  blockId: number,
  payload: Partial<{ block_type: string; content: string }>
): Promise<ApiBlock>

// DELETE /api/v1/meetings/:meeting_id/blocks/:id
export async function deleteBlock(meetingId: number, blockId: number): Promise<void>

// PATCH /api/v1/meetings/:meeting_id/blocks/:id/reorder
export async function reorderBlock(
  meetingId: number,
  blockId: number,
  payload: { prev_block_id: number | null; next_block_id: number | null }
): Promise<ReorderResponse>
```

---

### 3.2 포맷 변환 유틸: `frontend/src/lib/blockAdapter.ts`

BlockNote 블록 포맷과 API 블록 포맷 간 변환을 담당한다.

#### BlockNote → API block_type 매핑

| BlockNote type | API block_type |
|----------------|----------------|
| `paragraph`    | `text`         |
| `heading` (level 1) | `heading1` |
| `heading` (level 2) | `heading2` |
| `heading` (level 3) | `heading3` |
| `bulletListItem` | `bullet_list` |
| `numberedListItem` | `numbered_list` |
| `checkListItem` | `checkbox` |
| `quote`        | `quote`        |
| `transcript`   | `text` (커스텀 타입, 텍스트로 저장) |

#### 블록 ID 매핑

BlockNote는 자체 UUID를 블록 ID로 사용하고, 서버는 integer id를 사용한다.
`blockAdapter`는 `Map<string, number>` (BlockNote UUID → DB id) 매핑을 관리하며,
초기 로드 시 서버에서 받은 블록의 순서와 BlockNote 블록의 순서를 대응시켜 매핑을 구성한다.

```typescript
// API 블록 배열 → BlockNote initialContent 배열
export function apiBlocksToEditorBlocks(apiBlocks: ApiBlock[]): PartialBlock[]

// BlockNote 블록의 인라인 콘텐츠를 평문 문자열로 추출
export function extractTextContent(block: CustomBlock): string

// BlockNote block type → API block_type
export function toApiBlockType(bnType: string, props: Record<string, unknown>): string

// API block_type → BlockNote block type + props
export function fromApiBlockType(apiType: string): { type: string; props?: Record<string, unknown> }
```

---

### 3.3 `useBlockSync` 훅 설계

#### 시그니처

```typescript
interface UseBlockSyncOptions {
  meetingId: number
  editorRef: RefObject<BlockNoteEditor<typeof customSchema.blockSpecs> | null>
  debounceMs?: number  // 기본값: 800
}

interface UseBlockSyncReturn {
  isLoading: boolean     // 초기 로드 중 여부
  isSaving: boolean      // API 저장 요청 중 여부
  error: string | null   // 마지막 오류 메시지
  initialContent: PartialBlock[] | null  // 에디터 초기 콘텐츠
}

export function useBlockSync(options: UseBlockSyncOptions): UseBlockSyncReturn
```

#### 초기 로드 로직

```typescript
// 마운트 시 실행
useEffect(() => {
  setIsLoading(true)
  getBlocks(meetingId)
    .then((apiBlocks) => {
      const editorBlocks = apiBlocksToEditorBlocks(apiBlocks)
      // id 매핑 구성: apiBlocks[i].id ↔ editorBlocks[i].id (UUID)
      buildIdMapping(apiBlocks, editorBlocks)
      setInitialContent(editorBlocks)
    })
    .catch((err) => setError(err.message))
    .finally(() => setIsLoading(false))
}, [meetingId])
```

#### 변경 감지 및 디바운스 저장 로직

```typescript
// MeetingEditor의 onChange 콜백에서 호출
function handleEditorChange(currentBlocks: CustomBlock[]) {
  prevBlocksRef.current 와 currentBlocks를 비교 (diff)
  → 변경 사항 큐에 적재
  → debounce 타이머 리셋
}

// 디바운스 후 실행
async function flushChanges() {
  const diff = computeDiff(prevBlocksRef.current, currentBlocks)

  // 순서 변경 감지: 블록 순서 배열 비교
  // 내용 변경 감지: 블록 content/type 비교
  // 추가 감지: 이전에 없던 UUID
  // 삭제 감지: 현재에 없는 UUID

  await Promise.all([
    ...diff.added.map(b => createBlock(...)),
    ...diff.updated.map(b => updateBlock(...)),
    ...diff.deleted.map(id => deleteBlock(...)),
    ...diff.reordered.map(b => reorderBlock(...)),
  ])

  prevBlocksRef.current = currentBlocks
}
```

#### Diff 알고리즘

```typescript
interface BlockDiff {
  added: CustomBlock[]       // 새로 추가된 블록
  updated: CustomBlock[]     // content 또는 type이 변경된 블록
  deleted: string[]          // 삭제된 블록의 BlockNote UUID
  reordered: Array<{         // 순서가 변경된 블록
    block: CustomBlock
    prevBlockId: number | null
    nextBlockId: number | null
  }>
}

function computeDiff(prev: CustomBlock[], curr: CustomBlock[]): BlockDiff
```

순서 변경은 블록 UUID 배열의 순서를 비교하여 감지한다. 위치가 바뀐 블록에 대해 새 위치의 `prev_block_id`와 `next_block_id`를 계산해 reorder API를 호출한다.

#### ID 매핑 관리

```typescript
// BlockNote UUID → DB id 매핑
const idMapRef = useRef<Map<string, number>>(new Map())

// 블록 생성 후 매핑 등록
const apiBlock = await createBlock(meetingId, payload)
idMapRef.current.set(bnBlock.id, apiBlock.id)

// reorder 시 DB id 조회
const dbId = idMapRef.current.get(bnBlock.id)
```

---

### 3.4 MeetingPage 연동

`MeetingPage`에서 `useBlockSync`를 호출하고, 반환된 `initialContent`와 `handleEditorChange`를 `MeetingEditor`에 전달한다.

```typescript
// MeetingPage.tsx (요약)
const editorRef = useRef<BlockNoteEditor<...> | null>(null)
const { isLoading, isSaving, error, initialContent } = useBlockSync({
  meetingId: Number(params.id),
  editorRef,
})

// 로딩 중: 스피너 표시
// initialContent 준비 후: MeetingEditor 렌더링

<MeetingEditor
  initialContent={initialContent ?? undefined}
  onChange={handleChange}    // useBlockSync의 내부 함수를 노출하거나 직접 연결
  editorRef={editorRef}
/>
```

`useBlockSync`는 `onEditorChange` 함수를 반환 값에 추가하여 `MeetingEditor`의 `onChange`에 연결할 수 있도록 한다.

---

## 4. 엣지 케이스 처리

| 케이스 | 처리 방법 |
|--------|-----------|
| 저장 실패 | 에러 토스트 표시, 재시도 없음 (MVP) |
| 네트워크 오프라인 | 저장 실패로 처리, 에러 상태 노출 |
| 빠른 연속 편집 | 디바운스로 마지막 상태만 저장 |
| 블록 생성 전 reorder | 신규 블록은 create 후 매핑 획득, 이후 reorder |
| rebalance 응답 | 서버에서 전체 블록 반환 시 id 매핑 재구성 |
| 빈 문서 (initialContent 없음) | BlockNote 기본 단락 블록 1개로 초기화 |
| STT 블록 삽입 (useSttBlockInserter) | onChange 콜백을 통해 동일하게 diff 처리 |

---

## 5. 테스트 계획

### 5.1 단위 테스트: `blockAdapter.test.ts`

| 테스트 케이스 | 검증 내용 |
|---------------|-----------|
| `apiBlocksToEditorBlocks` | API 배열 → BlockNote 포맷 정확한 변환 |
| `toApiBlockType` | heading level 별 매핑, 커스텀 transcript 타입 |
| `fromApiBlockType` | API block_type → BlockNote type+props 역변환 |
| `extractTextContent` | 인라인 콘텐츠 배열에서 평문 추출 |

### 5.2 단위 테스트: `useBlockSync.test.ts`

vitest + `@testing-library/react` 환경에서 훅 테스트.

| 테스트 케이스 | 검증 내용 |
|---------------|-----------|
| 초기 로드 성공 | `getBlocks` 호출 → `initialContent` 설정 → `isLoading` false |
| 초기 로드 실패 | API 오류 → `error` 상태 설정 |
| 블록 추가 감지 | 새 블록 등장 시 `createBlock` 호출 확인 |
| 블록 수정 감지 | content 변경 시 `updateBlock` 호출 확인 |
| 블록 삭제 감지 | 블록 제거 시 `deleteBlock` 호출 확인 |
| 블록 순서 변경 | UUID 배열 순서 변경 시 `reorderBlock` 호출 확인 |
| 디바운스 | 연속 변경 시 API가 한 번만 호출됨 확인 (vi.useFakeTimers) |
| 저장 중 상태 | `isSaving` true/false 전환 확인 |

### 5.3 통합 확인 (수동)

- 에디터에서 텍스트 입력 후 800ms 경과 → DB에 저장 확인 (Rails 로그)
- 페이지 새로고침 후 편집 내용 복원 확인
- 블록 드래그로 순서 변경 후 새로고침 → 변경된 순서 유지 확인
- 블록 삭제 후 새로고침 → 삭제된 블록 없는 것 확인
