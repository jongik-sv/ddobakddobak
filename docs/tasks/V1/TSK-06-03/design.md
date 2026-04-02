# TSK-06-03: 회의 상세 페이지 UI - 설계

## 구현 방향

완료된 회의의 상세 정보를 통합 표시하는 `MeetingPage.tsx`를 확장한다. 현재 구현된 MeetingPage는 블록 에디터만 렌더링하는 최소 구현 상태이므로, 회의 메타 정보(제목·날짜·상태)·AI 요약 패널·Action Items 목록을 함께 표시하는 2-컬럼 레이아웃으로 교체한다. `getMeeting`으로 회의 기본 정보를 가져오고 `getSummary`로 AI 요약을 불러오며, Action Items는 기존 `ActionItemList` 컴포넌트를 재사용한다. 회의 삭제(DELETE) 및 제목 수정(PATCH)은 헤더 영역의 인라인 편집으로 지원한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/pages/MeetingPage.tsx` | 회의 상세 페이지 (에디터 + AI 요약 + Action Items 통합) | 수정 |
| `frontend/src/api/meetings.ts` | `updateMeeting`, `deleteMeeting` 함수 추가 | 수정 |
| `frontend/src/hooks/useMeeting.ts` | 회의 단건 조회 + 메타 수정/삭제 커스텀 훅 | 신규 |
| `frontend/src/pages/MeetingPage.test.tsx` | MeetingPage 렌더링·API 연동 단위 테스트 | 신규 |
| `frontend/src/App.tsx` | `/meetings/:id` 라우트 추가 (MeetingPage 연결) | 수정 |

---

## 주요 구조

**`useMeeting(meetingId)`**
- `getMeeting(id)`, `getSummary(id)` 병렬 호출로 초기 데이터 로드
- `updateTitle(title)`: `PATCH /api/v1/meetings/:id { title }` 호출 후 로컬 state 갱신
- `deleteMeeting()`: `DELETE /api/v1/meetings/:id` 호출 후 `/dashboard`로 라우팅
- 반환: `{ meeting, summary, teamMembers, isLoading, error, updateTitle, deleteMeeting }`

**`MeetingPage` (2-컬럼 레이아웃)**
- 좌측 메인 영역 (`flex-1`): 회의 메타 헤더 + `MeetingEditor` (블록 에디터, `useBlockSync` 연동)
- 우측 사이드바 (`w-80`): `AiSummarySection` (정적 요약 표시) + `ActionItemList`
- 헤더: 제목 인라인 편집(클릭 → `<input>` 전환), 상태 배지, 날짜/시간, 삭제 버튼

**`AiSummarySection` (MeetingPage 내 인라인 컴포넌트)**
- `getSummary` 결과를 props로 받아 핵심 요약·결정사항을 정적으로 렌더링
- 요약 없음 시 "회의 요약이 아직 생성되지 않았습니다" 빈 상태 표시

**`updateMeeting(id, { title })` / `deleteMeeting(id)`**
- `api/meetings.ts`에 추가하는 두 함수
- `PATCH /api/v1/meetings/:id`와 `DELETE /api/v1/meetings/:id` 각각 호출

---

## 데이터 흐름

`useParams` → `useMeeting(meetingId)` → `getMeeting` + `getSummary` 병렬 fetch → 회의 메타 + 요약 state 저장 → 좌측 에디터는 `useBlockSync`가 블록 API 독립 관리 → 우측 사이드바는 요약 state + `ActionItemList`(내부에서 `getActionItems` 직접 호출) 렌더링

---

## 선행 조건

- TSK-06-01: `GET /api/v1/meetings/:id`, `PATCH /api/v1/meetings/:id`, `DELETE /api/v1/meetings/:id`, `GET /api/v1/meetings/:id/summary` 엔드포인트 구현 완료
- TSK-04-01: `MeetingEditor`, `useBlockSync`, `ActionItemList`, `AiSummaryPanel` 컴포넌트 구현 완료
- `frontend/src/api/meetings.ts`: `getMeeting`, `getSummary` 이미 존재
- `frontend/src/api/actionItems.ts`: `getActionItems`, `updateActionItem`, `deleteActionItem` 이미 존재
