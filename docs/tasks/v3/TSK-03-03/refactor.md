# TSK-03-03: 리팩토링 결과

## 변경 사항
- 4개 통계 카드의 반복 마크업을 `StatCard` 컴포넌트로 추출하여 코드 중복 제거 (~50줄 -> 데이터 배열 + map 렌더링)
- 회의 상태 뱃지(녹음중/완료/대기중)의 3중 조건 분기를 `STATUS_BADGE` 설정 객체 + `StatusBadge` 컴포넌트로 통합
- `meetings.filter()` 2회 호출을 `countByStatus()` 단일 순회 함수로 통합, `useMemo`로 메모이제이션
- `isLoading && meetings.length === 0` 중복 조건을 `showSkeleton` 변수로 추출
- `pendingCount` 변수 도입으로 JSX 내 인라인 연산식 제거

## 테스트 확인
- PASS (55 files, 435 tests)
