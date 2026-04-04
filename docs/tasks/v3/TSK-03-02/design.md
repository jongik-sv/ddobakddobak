# TSK-03-02: MeetingsPage 툴바 모바일 대응 - 설계

## 구현 방향
- `useMediaQuery(BREAKPOINTS.lg)`로 데스크톱/모바일 분기
- 모바일: 검색 아이콘 탭 → 풀 너비 검색 바 확장, 필터 아이콘 → BottomSheet에서 필터 옵션 표시
- 새 회의 버튼을 모바일에서 FAB(`fixed right-4 bottom-20 lg:hidden z-40`)로 전환
- 카드 뷰의 brief_summary를 모바일에서 1줄로 압축, 날짜 상대 표시
- 기존 meetingStore 필터 상태/로직을 100% 재사용

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| frontend/src/pages/MeetingsPage.tsx | 툴바/헤더/카드 모바일 분기 적용 | 수정 |

## 주요 ���조

### 1. 모바일 검색 바 (MeetingsPage 내부)
- `isDesktop` false일 때 검색 input 숨기고 `Search` 아이콘 버튼 표시
- 아이콘 탭 시 `searchExpanded` 상태 toggle → 풀 너비 검색 input 표시 (헤더 영역 대체)
- 검색 바에 X 버튼으로 닫기 + 검색어 초기화

### 2. 필터 BottomSheet (MeetingsPage 내부)
- `filterSheetOpen` 상태 추가
- 모바일에서 기존 상태 필터 탭 + 날짜 필터를 BottomSheet 안으로 이동
- `Filter` 아이콘 버튼 탭 → BottomSheet open
- BottomSheet 내부: 상태 필터 (전체/녹음중/완료/대기중) + 날짜 범위 + 초기화 버튼
- 기존 `setStatusFilter`, `setDateFrom`, `setDateTo` 그대로 사용

### 3. FAB (새 회의 버튼)
- 모바일에서 헤더의 "새 회의" 버튼 숨김
- `fixed right-4 bottom-20 lg:hidden z-40` FAB 추가
- `Plus` 아이콘 + 원형 버튼
- 기존 `setShowModal(true)` 핸들러 재사용

### 4. 헤더 반응형 조정
- 모바일: 제목 `text-xl`, 헤더 버튼(회의 참여, 오디오 업로드) 아이콘 only
- 데스크톱: 기존과 100% 동일

### 5. 카드 모바일 압축
- `brief_summary`: `line-clamp-5` → 모바일에서 `line-clamp-1`
- `formatDate`: 모바일에서 상대 시간 표시 (`formatRelativeDate` 헬퍼)
- 액션 버튼(수정/이동/삭제): 모바일에서 `opacity-100` (hover 없으므로 항상 표시)

## 데이터 흐름
사용자 터치 → searchExpanded/filterSheetOpen 상태 토글 → meetingStore 필터 상태 변경 → fetchMeetings 호출 → 목록 리렌더링

## 선행 조건
- TSK-03-01: BottomSheet 공용 UI 컴포넌트 (완료 [xx])
- TSK-00-02: useMediaQuery 훅 및 BREAKPOINTS 상수 (완료)
