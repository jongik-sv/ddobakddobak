# TSK-03-02: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| frontend/src/pages/MeetingsPage.tsx | 상태 필터 탭 정의를 `STATUS_FILTER_TABS` 상수 + `StatusFilterTabs` 컴포넌트로 추출하여 데스크톱/모바일 BottomSheet 중복 제거 |
| frontend/src/pages/MeetingsPage.tsx | 회의 유형 선택 버튼을 `MeetingTypeSelector` 컴포넌트로 추출하여 CreateMeetingModal/UploadAudioModal 중복 제거 |
| frontend/src/pages/MeetingsPage.tsx | 카드 뷰/리스트 뷰의 회의 액션 버튼(수정/이동/삭제/종료)을 `MeetingActionButtons` 컴포넌트로 추출하여 중복 제거 |
| frontend/src/pages/MeetingsPage.tsx | 삭제 확인/종료 로직을 `handleDeleteMeeting`/`handleStopMeeting` 콜백으로 분리, 상태 필터 변경을 `handleStatusFilterSelect` 콜백으로 분리 |
| frontend/src/pages/MeetingsPage.tsx | `pageTitle` 계산 시 중복된 재귀 탐색 함수를 기존 `folderName` 유틸 함수 재사용으로 변경 |

## 테스트 확인
- 결과: PASS
- 전체 테스트: 58 파일 516 테스트 통과
