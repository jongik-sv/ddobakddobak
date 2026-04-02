# TSK-01-01 Refactor Report

> date: 2026-04-02
> reviewer: Claude Opus 4.6

## Files Reviewed

| File | Lines | Verdict |
|------|-------|---------|
| `backend/app/models/user.rb` | 19 | Clean |
| `backend/app/services/jwt_service.rb` | 43 | Clean |
| `backend/app/controllers/auth/sessions_controller.rb` | 53 | Clean |
| `backend/app/controllers/application_controller.rb` | 41 | Clean |
| `backend/config/initializers/devise.rb` | 22 | Clean |
| `backend/config/routes.rb` (auth section) | 14 lines relevant | Clean |
| `backend/spec/models/user_jwt_spec.rb` | 77 | Clean |
| `backend/spec/services/jwt_service_spec.rb` | 70 | Clean |
| `backend/spec/requests/auth/sessions_spec.rb` | 200 | Clean |

## What Was Changed

Nothing. The implementation is minimal, well-structured, and free of code smells.

## What Was Left As-Is and Why

### `JwtService`
- **`REFRESH_EXPIRATION = 30.days.to_i`** followed by `REFRESH_EXPIRATION.seconds.from_now.to_i` reads slightly redundant (integer seconds → `.seconds.from_now`), but it mirrors the pattern used for access tokens (`Devise::JWT.config.expiration_time.seconds.from_now.to_i`) and is numerically correct. Changing it would deviate from the consistent pattern across both token types.
- **No `freeze` on constants or `frozen_string_literal` pragma**: Consistent with the rest of the codebase. Adding them only here would be inconsistent.
- **Lambda for `SECRET`**: `SECRET = -> { Devise::JWT.config.secret }` is a good pattern — avoids accessing the config at class-load time when it might not be initialized yet. Left as-is.

### `Auth::SessionsController`
- **Empty `respond_with` / `respond_to_on_destroy` overrides**: Required by Devise's session controller contract. They are clearly commented. Left as-is.
- **`refresh` action rescue clause**: Catches `JWT::DecodeError`, `JWT::ExpiredSignature`, and `ActiveRecord::RecordNotFound` in a single rescue. This correctly handles all failure paths (bad token, expired token, user deleted) with a uniform 401 response. Left as-is.

### `ApplicationController`
- **Dual-mode `authenticate_user!` / `current_user`**: Clear branching on `server_mode?`. The memoization pattern (`@current_user ||=`) is idiomatic. Left as-is.

### `User` model
- **Two small methods** (`generate_refresh_token_jti!`, `revoke_refresh_token!`): Single-responsibility, descriptive names, bang convention for write operations. Left as-is.

### Tests
- Comprehensive coverage: model validations, Devise module inclusion, JTI lifecycle, JWT round-trip, token expiration, type validation, full request cycle (login/refresh/logout), SERVER_MODE branching. No gaps identified.

## Test Results After Review

```
33 examples, 0 failures
Finished in 6.82 seconds
```

All tests pass. No regressions.
