# TSK-01-06: 앱 레이아웃 및 네비게이션 - 테스트 리포트

## 실행 결과

- 실행 일시: 2026-03-24
- Test Files: 11 passed (11)
- Tests: 50 passed (50)
- Duration: 약 1.2s

## 신규 테스트 (TSK-01-06)

### src/components/layout/Sidebar.test.tsx (5개)
| # | 테스트명 | 결과 |
|---|---|---|
| 1 | 대시보드 링크가 렌더링됨 | PASS |
| 2 | 팀 목록 링크가 렌더링됨 | PASS |
| 3 | 대시보드 링크 href가 /dashboard임 | PASS |
| 4 | 팀 목록 링크 href가 /teams임 | PASS |
| 5 | md 이하에서 숨김 클래스를 가짐 | PASS |

### src/components/layout/Header.test.tsx (4개)
| # | 테스트명 | 결과 |
|---|---|---|
| 1 | 사용자 이름이 표시됨 | PASS |
| 2 | 로그아웃 버튼이 렌더링됨 | PASS |
| 3 | 로그아웃 버튼 클릭 시 logout()이 호출됨 | PASS |
| 4 | user가 null일 때 크래시 없이 렌더링됨 | PASS |

### src/components/layout/AppLayout.test.tsx (4개)
| # | 테스트명 | 결과 |
|---|---|---|
| 1 | children이 렌더링됨 | PASS |
| 2 | 사이드바가 렌더링됨 | PASS |
| 3 | 헤더가 렌더링됨 | PASS |
| 4 | 사용자 이름이 헤더에 표시됨 | PASS |

## 기존 테스트 회귀 결과 (37개 모두 PASS)

- PrivateRoute (2개): PASS
- HomePage (2개): PASS
- LoginPage (5개): PASS
- SignupPage (4개): PASS
- TeamPage (11개): PASS
- App 라우팅 (2개): PASS
- authStore (5개): PASS
- auth API (4개): PASS
- stores/authStore (5개): PASS

## 주의사항

- TeamPage 테스트에서 `act(...)` 미래 경고가 2건 출력됨. 이는 TSK-01-05에서 생성된 기존 파일의 문제로, 테스트 자체는 모두 PASS.
- 수정 없이 1회 실행에 전체 통과.
