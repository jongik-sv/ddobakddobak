# TSK-01-05 테스트 리포트

## 실행 일시
2026-03-24

## 테스트 환경
- Vitest v4.1.1
- React Testing Library
- jsdom

## 결과 요약

| 항목 | 결과 |
|------|------|
| 전체 테스트 파일 | 11 |
| 전체 테스트 케이스 | 50 |
| 통과 | 50 |
| 실패 | 0 |
| 소요 시간 | ~1.2s |

## TSK-01-05 신규 테스트 (TeamPage.test.tsx)

| # | 테스트 케이스 | 결과 |
|---|--------------|------|
| 1 | 팀 관리 페이지가 렌더링됨 | PASS |
| 2 | 팀 목록이 표시됨 | PASS |
| 3 | 팀 생성 폼이 존재함 | PASS |
| 4 | 팀 생성 성공 시 목록에 추가됨 | PASS |
| 5 | 팀 선택 시 팀원 목록이 표시됨 | PASS |
| 6 | admin 역할일 때 초대 폼이 표시됨 | PASS |
| 7 | member 역할일 때 초대 폼이 표시되지 않음 | PASS |
| 8 | admin 역할일 때 제거 버튼이 표시됨 | PASS |
| 9 | member 역할일 때 제거 버튼이 표시되지 않음 | PASS |
| 10 | 팀원 초대 성공 시 목록에 추가됨 | PASS |
| 11 | 팀원 제거 성공 시 목록에서 제거됨 | PASS |

## 기존 테스트 영향 없음

| 파일 | 테스트 수 | 결과 |
|------|---------|------|
| LoginPage.test.tsx | 5 | PASS |
| SignupPage.test.tsx | 4 | PASS |
| PrivateRoute.test.tsx | 2 | PASS |
| HomePage.test.tsx | 2 | PASS |
| AppLayout.test.tsx | 4 | PASS |
| Header.test.tsx | 4 | PASS |
| Sidebar.test.tsx | 5 | PASS |
| App.test.tsx | 2 | PASS |
| auth.test.ts | 4 | PASS |
| authStore.test.ts | 5 | PASS |

## 특이사항

- 일부 테스트에서 `act(...)` 미래 버전 경고 발생 (useEffect 내 비동기 상태 업데이트)
- 테스트 통과에는 영향 없음. 리팩토링 단계에서 개선 검토 완료
- vi.hoisted() 패턴으로 모든 mock 함수 정상 호이스팅
