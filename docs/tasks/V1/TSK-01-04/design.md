# TSK-01-04: 로그인/회원가입 프론트엔드 UI - 설계

## 구현 방향
- 기존 LoginPage/authStore/client 골격을 완성: API 연동 + 리다이렉트 + 보호 라우트
- authStore에 `login(token, user)` 단일 액션 추가 (token + user + isAuthenticated 원자 설정)
- api/client.ts에 afterResponse 401 인터셉터 → authStore.logout() 자동 호출
- PrivateRoute (Outlet 패턴) 으로 미인증 접근 차단

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `src/api/auth.ts` | login(), signup() API 함수 | 신규 |
| `src/api/client.ts` | 401 afterResponse 인터셉터 추가 | 수정 |
| `src/stores/authStore.ts` | login(token, user) 액션 추가 | 수정 |
| `src/hooks/useAuth.ts` | login 액션 노출 | 수정 |
| `src/pages/LoginPage.tsx` | API 연동, 에러 표시, /dashboard 리다이렉트 | 수정 |
| `src/pages/SignupPage.tsx` | 회원가입 폼 + API 연동 | 신규 |
| `src/pages/DashboardPage.tsx` | 로그인 성공 랜딩 (placeholder) | 신규 |
| `src/components/PrivateRoute.tsx` | 미인증 → /login 리다이렉트 | 신규 |
| `src/App.tsx` | /signup, /dashboard 라우트 추가, PrivateRoute 적용 | 수정 |

**테스트 파일:**

| 파일 경로 | 신규/수정 |
|---|---|
| `src/api/auth.test.ts` | 신규 |
| `src/stores/authStore.test.ts` | 수정 (login 액션 테스트 추가) |
| `src/pages/LoginPage.test.tsx` | 수정 (API 연동 테스트 추가) |
| `src/pages/SignupPage.test.tsx` | 신규 |
| `src/components/PrivateRoute.test.tsx` | 신규 |

## 주요 구조

- `login(email, password)` → POST /auth/sign_in → `{ token, user }`
- `signup(name, email, password)` → POST /auth/sign_up → `{ token, user }`
- `useAuthStore.login(token, user)` → 원자적 인증 상태 설정
- `PrivateRoute` → Outlet 패턴, isAuthenticated false 시 Navigate to="/login"
- `apiClient` → afterResponse에서 401 감지 → useAuthStore.getState().logout()

## 데이터 흐름

```
LoginPage 폼 제출
  → login(email, password) [api/auth.ts]
  → POST /api/v1/auth/sign_in [ky]
  → { token, user } 응답
  → authStore.login(token, user) [Zustand persist]
  → navigate('/dashboard')

미인증 접근
  → PrivateRoute.isAuthenticated === false
  → Navigate to="/login"

API 401 응답
  → client.ts afterResponse
  → authStore.logout()
  → (PrivateRoute가 /login으로 리다이렉트)
```

## 선행 조건
- TSK-00-02: frontend 프로젝트 셋업 (완료)
- TSK-01-01: backend auth API (병렬 작업 중 → mock으로 테스트)
- 엔드포인트: POST /api/v1/auth/sign_in, POST /api/v1/auth/sign_up
