# TSK-04-03 테스트 리포트: 에디터 ↔ API 동기화

## 실행 일시

2026-03-25

## 테스트 실행 결과

| 구분 | 수 |
|------|-----|
| 전체 테스트 파일 | 23 |
| 전체 테스트 케이스 | 163 |
| 통과 | 163 |
| 실패 | 0 |

모든 테스트가 **최초 실행에서 전량 통과**하였다. 수정 작업 없음.

```
 Test Files  23 passed (23)
      Tests  163 passed (163)
   Duration  2.16s (transform 853ms, setup 1.00s, import 2.07s, tests 3.49s, environment 8.30s)
```

---

## TSK-04-03 관련 테스트 목록

### 1. `src/lib/__tests__/blockAdapter.test.ts`

blockAdapter 유틸리티 함수(에디터 ↔ API 타입 변환)에 대한 단위 테스트.

#### `toApiBlockType` (10개)

| 테스트명 | 결과 |
|----------|------|
| paragraph → text | 통과 |
| heading level 1 → heading1 | 통과 |
| heading level 2 → heading2 | 통과 |
| heading level 3 → heading3 | 통과 |
| bulletListItem → bullet_list | 통과 |
| numberedListItem → numbered_list | 통과 |
| checkListItem → checkbox | 통과 |
| quote → quote | 통과 |
| transcript (커스텀 타입) → text | 통과 |
| 알 수 없는 타입 → text (기본값) | 통과 |

#### `fromApiBlockType` (9개)

| 테스트명 | 결과 |
|----------|------|
| text → paragraph | 통과 |
| heading1 → heading + level 1 | 통과 |
| heading2 → heading + level 2 | 통과 |
| heading3 → heading + level 3 | 통과 |
| bullet_list → bulletListItem | 통과 |
| numbered_list → numberedListItem | 통과 |
| checkbox → checkListItem | 통과 |
| quote → quote | 통과 |
| 알 수 없는 API 타입 → paragraph (기본값) | 통과 |

#### `apiBlocksToEditorBlocks` (5개)

| 테스트명 | 결과 |
|----------|------|
| 빈 배열 → 빈 배열 | 통과 |
| text 타입 API 블록 → paragraph 에디터 블록으로 변환 | 통과 |
| heading1 API 블록 → heading 에디터 블록 (level 1) | 통과 |
| 여러 블록 변환 시 순서 유지 | 통과 |
| content 문자열이 에디터 블록의 인라인 콘텐츠로 변환됨 | 통과 |

#### `extractTextContent` (5개)

| 테스트명 | 결과 |
|----------|------|
| 빈 content → 빈 문자열 | 통과 |
| 단일 텍스트 인라인 콘텐츠 추출 | 통과 |
| 여러 인라인 콘텐츠 이어붙이기 | 통과 |
| content가 undefined이면 빈 문자열 반환 | 통과 |
| text 타입이 아닌 인라인 콘텐츠는 무시 | 통과 |

**소계: 29개 전량 통과**

---

### 2. `src/hooks/__tests__/useBlockSync.test.ts`

useBlockSync 훅(에디터 변경사항 감지 → API 호출)에 대한 단위 테스트.
`vi.mock('../../api/blocks')`로 API 모듈 전체를 모킹하여 격리 테스트 수행.

#### `초기 로드` (4개)

| 테스트명 | 결과 |
|----------|------|
| 마운트 시 getBlocks를 호출하고 initialContent를 설정한다 | 통과 |
| 초기 로드 성공 시 isLoading이 false로 전환된다 | 통과 |
| 초기 로드 실패 시 error 상태가 설정된다 | 통과 |
| 빈 블록 배열 → initialContent가 빈 배열로 설정된다 | 통과 |

#### `블록 추가 감지` (1개)

| 테스트명 | 결과 |
|----------|------|
| 새 블록 등장 시 createBlock이 호출된다 | 통과 |

#### `블록 수정 감지` (1개)

| 테스트명 | 결과 |
|----------|------|
| content 변경 시 updateBlock이 호출된다 | 통과 |

#### `블록 삭제 감지` (1개)

| 테스트명 | 결과 |
|----------|------|
| 블록이 사라지면 deleteBlock이 호출된다 | 통과 |

#### `블록 순서 변경` (1개)

| 테스트명 | 결과 |
|----------|------|
| UUID 배열 순서 변경 시 reorderBlock이 호출된다 | 통과 |

#### `디바운스` (2개)

| 테스트명 | 결과 |
|----------|------|
| 연속 변경 시 API가 한 번만 호출된다 | 통과 |
| 800ms가 지나기 전에는 API를 호출하지 않는다 | 통과 |

#### `저장 중 상태` (1개)

| 테스트명 | 결과 |
|----------|------|
| API 저장 중 isSaving가 true로 전환된다 | 통과 |

**소계: 11개 전량 통과**

---

## TSK-04-03 테스트 요약

| 파일 | 테스트 수 | 통과 | 실패 |
|------|-----------|------|------|
| blockAdapter.test.ts | 29 | 29 | 0 |
| useBlockSync.test.ts | 11 | 11 | 0 |
| **합계** | **40** | **40** | **0** |

---

## 커버리지

커버리지 수집은 이번 실행에서 별도 설정하지 않았음. 테스트 대상 함수 기준 커버리지:

- `toApiBlockType`: 모든 분기(paragraph, heading 1/2/3, bulletListItem, numberedListItem, checkListItem, quote, 기본값) 커버
- `fromApiBlockType`: 모든 분기 커버
- `apiBlocksToEditorBlocks`: 빈 배열 / 단일 / 복수 블록 케이스 커버
- `extractTextContent`: 빈 배열 / undefined / 단일 / 복수 / 비text 타입 필터 케이스 커버
- `useBlockSync`: 초기 로드 성공/실패, CRUD 감지, 디바운스, 저장 중 상태 커버

---

## 이슈 및 해결

없음. 모든 테스트가 최초 실행에서 통과하였다.
