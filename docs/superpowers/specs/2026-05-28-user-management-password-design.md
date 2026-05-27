# 사용자 관리 + 비밀번호 설계

- 작성일: 2026-05-28
- 상태: 설계 확정 (사용자 승인)

## 배경

또박또박 백엔드는 이미 일부 사용자 관리 기능을 갖추고 있다.

- **관리자 사용자 관리** (`api/v1/admin/users_controller.rb` + `frontend/.../UserManagementPanel.tsx`): 목록 / 생성(이메일·이름·비밀번호·역할) / 역할 변경 / 삭제(본인 삭제 차단).
- **회원가입** (Devise `auth/registrations_controller.rb`, `auth/browser_registrations_controller.rb`): 첫 사용자 자동 admin, 이후 member. JWT(`jti`) + refresh 토큰(`refresh_token_jti`).
- **하이브리드 인증** (메모리 `project_hybrid_auth`): 로컬모드/loopback → `desktop@local`(admin) 자동 로그인. server_mode + 원격 → JWT 필수.

빠진 것:

1. **비밀번호 변경 기능 전무** — 본인 변경, 관리자 초기화 모두 없음.
2. 셀프 회원가입이 열려 있음 (server_mode에서 누구나 가입 가능).
3. 관리자 수정에서 이메일 변경 불가.

## 목표

- server_mode 회원가입을 **admin 생성 전용**으로 전환 (셀프가입 차단).
- 로컬 실행 시 admin(`desktop@local`)으로 전체 관리 가능함을 보장.
- 본인 비밀번호 변경 + 관리자 비밀번호 초기화 추가.
- 비밀번호 변경/초기화 시 기존 세션 전면 무효화.
- 관리자 패널에 이메일 수정 추가.

## 운영 그림

- **admin은 로컬(맥 본체)에서** 계정 생성 + 비밀번호 설정/초기화 →
- **원격 사용자**는 발급받은 계정으로 server_mode 로그인 → 본인이 비밀번호 변경.

## 결정 사항 (브레인스토밍 합의)

| 항목 | 결정 |
|------|------|
| 회원가입 정책 | admin 초대/생성 전용, 셀프가입 차단 |
| 본인 비밀번호 변경 | 현재 비밀번호 확인 필요 |
| 관리자 비밀번호 초기화 | 임시 비밀번호 자동 생성 (1회 표시, admin 수동 전달) |
| 세션 처리 | 변경/초기화 후 기존 세션(JWT + refresh) 전면 무효화 |
| 강제 비번 교체(다음 로그인) | 제외 (YAGNI) |
| 접근 방식 | 비밀번호 로직은 전용 엔드포인트로 분리 |

## 설계 명세

### 1. 회원가입 정책 — 셀프가입 차단

- `config/routes.rb`에서 Devise 셀프 등록 경로 제거:
  - `devise_for :users`의 `controllers`에서 `registrations` 제거 + `skip: [:registrations]` 적용.
  - `auth/web_register` (`get`/`post`) HTML 라우트 제거.
- `auth/registrations_controller.rb`, `auth/browser_registrations_controller.rb` 및 `register_form_template.rb`는 라우트 제거로 도달 불가 → 삭제.
- React 앱에는 원래 가입 화면이 없으므로 프론트 영향 없음.
- **부트스트랩**: 첫 admin은 로컬모드 `desktop@local`(자동 admin)이 담당. 별도 첫-가입 승격 로직 불필요.

### 2. 로컬 = admin 보장 + desktop@local 보호

- 하이브리드 인증으로 로컬모드/loopback에서 `desktop@local`(admin) 자동 로그인 → 맥 본체에서 즉시 전체 관리 가능 (기존 동작 유지).
- **`desktop@local` 보호** (admin `users_controller`):
  - 삭제 거부 (현재는 "본인 삭제"만 차단 → `desktop@local` 대상도 차단 추가).
  - role 강등(admin→member) 거부.
- 식별: `desktop@local`은 이메일 문자열로 판별 (`DefaultUserLookup#local_default_user`가 이 이메일로 생성). User 모델에 `LOCAL_EMAIL = "desktop@local"` 상수 + `local_account?` 헬퍼 추가하고, concern도 이 상수를 참조하도록 정리.

### 3. 세션 무효화 헬퍼 (User 모델)

```ruby
# 모든 세션(access + refresh) 무효화
def invalidate_all_sessions!
  update!(jti: SecureRandom.uuid, refresh_token_jti: nil)
end
```

- `jti` 회전 → 기존 access token(JTIMatcher) 거부.
- `refresh_token_jti = nil` → 기존 refresh token 거부.
- 3·4번에서 공용 사용.

### 4. 본인 비밀번호 변경

- **엔드포인트**: `PATCH /api/v1/user/password`
- 라우트: `namespace :user` 안에 `resource :password, only: [:update]` (또는 `patch "password"`).
- 컨트롤러: `Api::V1::User::PasswordsController#update`, `before_action :authenticate_user!`.
- 입력: `current_password`, `new_password`, `new_password_confirmation`.
- 흐름:
  1. `desktop@local`이면 거부 (403) — 자동로그인 계정은 비번 변경 의미 없음.
  2. `current_user.valid_password?(current_password)` 실패 → 422 `{ error: "현재 비밀번호가 일치하지 않습니다." }`.
  3. `new_password` == `new_password_confirmation` 검증, 길이 검증(Devise 기본, 6자 이상).
  4. `update(password: new_password)` 성공 시 → `invalidate_all_sessions!`.
  5. **현재 클라이언트용 새 토큰쌍 재발급** (로그아웃 방지): `sign_in` 으로 새 JWT 디스패치 + `generate_refresh_token_jti!` + `JwtService.encode_refresh_token`.
  6. 응답: `{ access_token, refresh_token }`.
- **UI**: 설정 화면에 "계정 / 비밀번호" 섹션.
  - 입력: 현재 비밀번호 / 새 비밀번호 / 새 비밀번호 확인.
  - JWT 실계정에만 노출, `desktop@local`엔 숨김.
  - 성공 시 authStore 토큰 갱신 + 성공 토스트.
  - API: `frontend/src/api/auth.ts` 또는 신규 `account.ts`에 `changePassword()`.

### 5. 관리자 비밀번호 초기화

- **엔드포인트**: `POST /api/v1/admin/users/:id/reset_password` (admin 전용).
- 라우트: `namespace :admin` `resources :users` 의 `member do post :reset_password end`.
- 흐름:
  1. 대상 사용자 조회 (`set_user`).
  2. **임시 비밀번호 자동 생성**: `SecureRandom` 기반 12자 (대소문자+숫자, Devise 길이 충족).
  3. `user.update(password: temp_password)` → `user.invalidate_all_sessions!`.
  4. 응답: `{ temp_password: "..." }`.
- **UI**: 관리 패널 각 행에 "비번 초기화" 버튼(아이콘) →
  - 확인 다이얼로그 → 호출 → 반환된 임시 비번을 **1회 모달로 표시(복사 버튼)**.
  - admin이 사용자에게 수동 전달 (SMTP 없음).
- 임시 비번은 일반 비번처럼 동작 — 사용자가 이후 본인 변경(4번)으로 교체.

### 6. 관리자 패널 보완 — 이메일 수정

- `admin/users_controller#update_params`에 `:email` 추가 (유니크 검증은 모델 위임, 충돌 시 422 에러 메시지 노출).
- 프론트: 행에서 이름/이메일 인라인 또는 모달 편집. `updateAdminUser` 파라미터에 `email?` 추가.

## 데이터/마이그레이션

- 신규 컬럼 없음. 기존 `jti`, `refresh_token_jti`, `encrypted_password` 재사용.

## 보안 고려

- 임시 비번은 응답 본문 평문 1회 노출 (자체 호스팅, admin만 접근, SMTP 없음 → 허용).
- `reset_password`는 admin 전용 + `desktop@local` 자기초기화 무의미하나 차단 불필요(자동로그인).
- 본인 변경은 현재 비번 확인으로 세션 탈취 방어. 변경 즉시 타 세션 무효화.

## 테스트

### 백엔드 (request spec)
- 본인 변경: 현재 비번 일치 → 성공 + 새 토큰 반환 + 옛 access token 거부(401) + 옛 refresh 거부.
- 본인 변경: 현재 비번 불일치 → 422.
- 본인 변경: `desktop@local`(loopback) → 403.
- admin 초기화: admin → temp 반환 + 대상 옛 토큰 거부. member 호출 → 403.
- 셀프가입 차단: `POST /auth`(JSON) 및 `GET/POST /auth/web_register` → 라우트 없음(404).
- desktop@local 보호: 삭제 거부 / member 강등 거부.

### 프론트
- 비밀번호 섹션: JWT 계정 렌더, `desktop@local` 숨김.
- admin 초기화 모달: 임시 비번 표시 + 복사.
- 이메일 편집 저장.

## 영향 파일 (예상)

**백엔드**
- `config/routes.rb` (등록 라우트 제거, password/reset_password 추가)
- `app/models/user.rb` (`invalidate_all_sessions!`)
- `app/controllers/api/v1/user/passwords_controller.rb` (신규)
- `app/controllers/api/v1/admin/users_controller.rb` (reset_password, email, desktop@local 보호)
- 삭제: `auth/registrations_controller.rb`, `auth/browser_registrations_controller.rb`, `services/register_form_template.rb`

**프론트**
- `src/api/adminUsers.ts` (resetPassword, email)
- `src/api/auth.ts` 또는 신규 `account.ts` (changePassword)
- `src/components/settings/UserManagementPanel.tsx` (초기화 버튼/모달, 이메일 편집)
- 설정 화면에 비밀번호 변경 섹션 (신규 컴포넌트)

## 비범위 (YAGNI)

- 이메일 기반 비번 찾기/리셋 (SMTP 없음).
- 강제 비번 교체(다음 로그인).
- 셀프가입 + 승인 대기 흐름.
- 2FA, 비번 정책 강화(복잡도 규칙).
