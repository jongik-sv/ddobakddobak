# 이전 회의 참고 (시드+이어쓰기) — 설계

- 날짜: 2026-06-14
- 브랜치: `feat/prev-meeting-reference`
- 상태: 설계 승인됨, 구현 대기

## 1. 목적

회의 생성 시 **이전 회의를 지정**하면, 그 회의의 회의록을 현재 회의록의 **시작점(base)**으로 깔고, 현재 회의 트랜스크립트로 **이어서 누적**한다.

- 입력 정의: **이전 회의록(notes_markdown) + 현재 회의 트랜스크립트**.
- 결과: 이전 내용 + 현재 내용이 합쳐진 하나의 연속 회의록.
- "델타" 개념 폐기. 단순 시드+이어쓰기.

## 2. 확정 결정

| 항목 | 결정 |
|------|------|
| 합성 방식 | 시드+이어쓰기(누적). 이전 회의록=base, 현재 트랜스크립트로 이어감 |
| 지정 시점 | 회의 **생성 시** 지정 (+ 시작 전 EditMeetingDialog 변경 허용) |
| 라이브 반영 | 녹음 중 실시간 요약에도 반영 (realtime + final 모두 seed) |
| 이전 회의록 고정 | **마커+프롬프트 규칙** (마커 위 = 이전 회의, 수정·재구조화 금지) |
| 참조 깊이 | 단일 참조만, 체인 없음 |
| 1차 범위 | 이전 **회의록(notes_markdown)만**. 첨부 안건파일 md 참조는 별도 과제 |

## 3. 데이터 모델

### Migration
- `meetings.previous_meeting_id` : integer, nullable, FK→meetings, index 추가.

### Model (`app/models/meeting.rb`)
```ruby
belongs_to :previous_meeting, class_name: "Meeting", optional: true
validate :previous_meeting_not_self
```
- `previous_meeting_not_self`: `previous_meeting_id == id`이면 무효.
- 추가 컬럼 없음. **시드는 일반 Summary 레코드로 실체화**(§4).

## 4. 시드 메커니즘 (백엔드 핵심)

### "이전 회의록"의 정의
`previous_meeting`의 최신 `summary.notes_markdown` **스냅샷**.
- `previous_meeting.summaries.order(generated_at: :desc, id: :desc).first&.notes_markdown`

### `seed_from_previous!(meeting)` 헬퍼
- 조건: `meeting.summaries`가 0개 **AND** `meeting.previous_meeting_id` 존재 **AND** 이전 회의록 비어있지 않음.
- 동작: 현재 회의에 **초기 Summary 1건** 생성.
  - `notes_markdown` = 이전 회의록 + 마커 (§5 마커 형식).
  - `generated_at` = now. Summary 스키마의 NOT NULL 컬럼 전부 충족(구현 시 schema.rb 확인 — notes_markdown/generated_at 필수, summary_type 등 기본값).
- 조건 미충족 시 no-op (멱등).

### 호출 지점
1. `MeetingSummarizationJob` 진입부 (realtime/final 양쪽 공통 경로) — 첫 요약 직전 호출.
2. `meetings_controller#regenerate_notes` — 기존 summary destroy **직후**, final job enqueue **전** 재시드.

### 이후 흐름 (기존 로직 무변경)
- base = `meeting.summaries.order(...).first&.notes_markdown` (= 방금 만든 시드).
- realtime: `append_notes`(restructure=false) / `refine_notes`(restructure=true)가 시드 위로 누적.
- final/regenerate: 동일.
- 결과: 이전 회의록이 prefix, 현재 트랜스크립트가 그 아래 누적.

### 스냅샷 의미
이전 회의가 나중에 바뀌어도 현재 회의 시드는 고정(복사 시점 동결). 갱신 원하면 재지정 후 재생성.

## 5. 이전 회의록 고정(frozen) — 프롬프트

### 마커
시드 회의록은 다음 경계 마커를 포함:
```
<이전 회의록 본문 그대로>

---
## 📋 이전 회의 이어받음
```
(마커 위 = 이전 회의록, 마커 아래 = 현재 회의 내용)

### 프롬프트 규칙
- `refine_notes` / `append_notes` 시스템 프롬프트에 규칙 추가:
  - "마커(`## 📋 이전 회의 이어받음`) 위 내용은 이전 회의록이다. **절대 수정·재구조화·삭제하지 말 것.** 마커 아래에만 현재 회의 내용을 작성."
- 효과:
  - `restructure=false`(append): 새 블록만 추가 → 자연히 보존.
  - `restructure=true`(refine): 마커 아래(현재 회의)만 재구조화, 이전 회의록 보존.
- restructure 토글은 **현재 회의 부분에만** 적용.

### 리스크/폴백
- refine 모드는 LLM이 "마커 위 수정 금지" 규칙을 100% 지킨다는 보장 없음(이전 회의록 변조 가능). 구현 단계 검증에서 보존 실패가 확인되면 **previous_meeting 설정 시 append 모드 강제**로 폴백(restructure 무시). 1차는 마커+규칙으로 시도.

## 6. 프론트엔드

### CreateMeetingModal (`components/meeting/CreateMeetingModal.tsx`)
- "이전 회의 참고(선택)" 셀렉트 추가.
- 옵션: 현재 사용자 `accessible_by` 회의, 최근순, 제목 검색.
- 선택 시 `previous_meeting_id` 전송.

### EditMeetingDialog (`components/meeting/EditMeetingDialog.tsx`)
- 동일 필드 추가. **회의 시작 전** 변경용. 기존 `updateMeeting` PATCH 재사용.

### API (`api/meetings.ts`)
- `createMeeting` 시그니처에 `previous_meeting_id?: number` 추가.
- `UpdateMeetingParams`에 `previous_meeting_id?: number | null` 추가.
- `Meeting` 인터페이스에 `previous_meeting_id?`, `previous_meeting_title?`(serializer 제공) 추가.

### 라이브/미리보기 페이지
- 시드가 base로 깔려 `AiSummaryPanel`에 **자동 표시** (별도 렌더링 UI 불필요).
- 상단에 "이전 회의 참고: <제목>" 배지 표시 (`MeetingLivePage`, `MeetingPage`).

### 백엔드 직렬화 (`concerns/meeting_serializable.rb`)
- `previous_meeting_id`, `previous_meeting_title` 출력.

## 7. 엣지/제약

- 이전 회의에 summary 없음 → 시드 없음(빈 base), 프론트에서 경고 토스트.
- `previous_meeting_id == self` → validation 거부.
- 체인 없음: 단일 참조만 (이전 회의록에 이미 그 이전이 누적됨).
- 권한: 선택/시드 가능 회의 = 현재 사용자 `accessible_by` 범위. 시드 시 이전 회의 열람 권한 재확인.
- 1차: notes_markdown만. 첨부 안건파일 md 참조는 별도(idea.md 79–90).

## 8. 테스트 (TDD)

### 백엔드
- `seed_from_previous!`:
  - summary 0개 + previous有 + 이전회의록 존재 → 초기 summary 생성, notes에 마커+이전내용 포함.
  - summary 존재 → no-op.
  - previous nil → no-op.
  - 이전 회의록 빈 문자열 → no-op.
- `regenerate_notes`: 기존 summary destroy 후 재시드 → 이전 prefix 유지.
- append 모드: 시드 위 새 블록 누적, 마커 위 이전 내용 보존.
- refine 모드: 마커 아래만 변경, 마커 위 보존 (프롬프트 규칙 검증 — LLM 모킹 또는 프롬프트 조립 단위 검증).
- validation: self-reference 거부.

### 프론트
- `createMeeting`가 `previous_meeting_id` round-trip.
- CreateMeetingModal 셀렉트가 accessible 회의 목록 노출.

## 9. 구현 순서 (제안)

1. Migration + Meeting 모델(belongs_to + validation) + 직렬화.
2. `seed_from_previous!` 헬퍼 + 단위 테스트.
3. `MeetingSummarizationJob` / `regenerate_notes` 호출 배선.
4. 프롬프트 마커 규칙(`llm_prompts.rb`) + 조립 테스트.
5. API 시그니처 확장(`api/meetings.ts`).
6. CreateMeetingModal / EditMeetingDialog 셀렉트.
7. 라이브/미리보기 배지.
8. 전체 검증 (백엔드 spec + 프론트 build).

## 9.1 추가 요청 (2026-06-14 사용자, 미구현 — 다음 세션)

구현완료(§1~8)는 그대로 두고 아래 2건을 이어서 작업한다. **지금 구현 안 함.**

1. **EditMeetingDialog(연필/회의 정보수정)에도 이전 회의 셀렉터 추가**
   - `EditMeetingDialog`에 previousMeetingId 상태 + 셀렉터 UI(초기값 = `meeting.previous_meeting_id`).
   - `onConfirm` 콜백 시그니처에 `previous_meeting_id` 추가.
   - 부모 핸들러 배선: `MeetingPage.tsx:637` onConfirm, `MeetingLivePage.tsx:453` onConfirm(UpdateMeetingParams) → `updateMeeting`에 전달.
   - 백엔드 update는 이미 `previous_meeting_id` 수용함(§5 구현됨) — 프론트만 연결.

2. **같은 폴더 회의만 참고 대상**
   - 셀렉터 데이터: `getMeetings({ folder_id, per: 100 })` 로 필터.
     - CreateMeetingModal = `folderId` prop, EditMeetingDialog = `meeting.folder_id`. null = 루트 폴더.
   - 백엔드 `accessible_previous_meeting_id` 에 same-folder 검증 추가:
     `candidate.folder_id == 대상_folder_id` 일 때만 통과(아니면 nil).
     - create 대상 folder = `params[:folder_id].presence&.to_i`.
     - update 대상 folder = `params.key?(:folder_id) ? 정규화 : @meeting.folder_id`.
   - 교차폴더 drop 테스트 추가. 기존 request spec 은 전부 루트(folder nil)라 무영향.

## 10. 범위 외 (Out of scope, 1차)

- 첨부 안건파일(pptx/xlsx/image) → md 추출 후 참조 (별도 과제).
- 다중/체인 이전 회의 참조.
- 이전 결정 번복 시 이전 회의록 부분 수정/취소선 표시.
