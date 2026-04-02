# TSK-01-01: 테스트 리포트

## 실행 결과

```
15 examples, 0 failures, 1 pending
```

## 테스트 목록

| 테스트 | 결과 |
|--------|------|
| POST /api/v1/signup - valid params: creates a user and returns token | ✅ |
| POST /api/v1/signup - valid params: creates a user in the database | ✅ |
| POST /api/v1/signup - invalid: email blank → 422 | ✅ |
| POST /api/v1/signup - invalid: password too short → 422 | ✅ |
| POST /api/v1/signup - invalid: email already taken → 422 | ✅ |
| POST /api/v1/login - valid credentials: returns token and user | ✅ |
| POST /api/v1/login - wrong password → 401 | ✅ |
| POST /api/v1/login - non-existent email → 401 | ✅ |
| DELETE /api/v1/logout - valid token: invalidates and returns 204 | ✅ |
| DELETE /api/v1/logout - valid token: rejects subsequent with old token | ✅ |
| DELETE /api/v1/logout - no token → 401 | ✅ |
| Health check | ✅ |

## 수정 이력

1. API 모드에서 세션 미들웨어 추가 (`ActionDispatch::Cookies`, `CookieStore`)
2. SessionsController에서 double render 오류 수정 (`return unless authenticate_user!`)
3. Routes를 `devise_scope` 방식으로 변경 (namespace 내 명시적 라우트)
