# 사용자 관리 + 비밀번호 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** server_mode 셀프가입을 차단하고, 본인 비밀번호 변경 + 관리자 비밀번호 초기화(임시 비번) + 관리자 이메일 수정을 추가하며, 비밀번호 변경/초기화 시 모든 세션을 무효화한다.

**Architecture:** 비밀번호 로직은 전용 엔드포인트로 분리한다 — 본인용 `PATCH /api/v1/user/password`, 관리자용 `POST /api/v1/admin/users/:id/reset_password`. 세션 무효화는 `User#invalidate_all_sessions!`(jti 회전 + refresh_token_jti 제거)로 통일한다. 부트스트랩 admin은 로컬모드 `desktop@local`(자동 admin)이 담당하므로 Devise 셀프 등록은 완전히 제거한다.

**Tech Stack:** Rails (Devise + devise-jwt JTIMatcher), RSpec / FactoryBot, React + TypeScript, ky, zustand, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-28-user-management-password-design.md`

---

## File Structure

**백엔드 (수정/생성/삭제)**
- Modify `backend/app/models/user.rb` — `LOCAL_EMAIL` 상수, `local_account?`, `invalidate_all_sessions!`
- Modify `backend/app/controllers/concerns/default_user_lookup.rb` — `User::LOCAL_EMAIL` 참조
- Modify `backend/config/routes.rb` — Devise 셀프등록 제거, `user/password`·`admin reset_password` 추가
- Modify `backend/app/controllers/api/v1/admin/users_controller.rb` — `reset_password`, email 수정, `desktop@local` 보호
- Create `backend/app/controllers/api/v1/user/passwords_controller.rb` — 본인 비밀번호 변경
- Delete `backend/app/controllers/auth/registrations_controller.rb`, `backend/app/controllers/auth/browser_registrations_controller.rb`, `backend/app/services/register_form_template.rb`
- Create `backend/spec/requests/api/v1/user/passwords_spec.rb`
- Create `backend/spec/requests/auth/registration_disabled_spec.rb`
- Modify `backend/spec/models/user_spec.rb` (없으면 생성), `backend/spec/requests/api/v1/admin/users_spec.rb`

**프론트 (수정/생성)**
- Modify `frontend/src/api/adminUsers.ts` — `resetAdminUserPassword`, `updateAdminUser`에 `email`
- Create `frontend/src/api/account.ts` — `changePassword`
- Modify `frontend/src/components/settings/UserManagementPanel.tsx` — 비번 초기화 버튼/모달, 이메일 편집
- Create `frontend/src/components/settings/PasswordChangeSection.tsx`
- Modify `frontend/src/components/settings/SettingsContent.tsx` — PasswordChangeSection 삽입
- Create `frontend/src/api/account.test.ts`, `frontend/src/components/settings/PasswordChangeSection.test.tsx`

---

## Task 1: User 모델 — 세션 무효화 + 로컬 계정 식별

**Files:**
- Modify: `backend/app/models/user.rb`
- Modify: `backend/app/controllers/concerns/default_user_lookup.rb:23`
- Test: `backend/spec/models/user_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/models/user_spec.rb` (파일 없으면 생성, 있으면 describe 추가):

```ruby
require "rails_helper"

RSpec.describe User, type: :model do
  describe "#local_account?" do
    it "is true for desktop@local" do
      expect(build(:user, email: "desktop@local").local_account?).to be true
    end

    it "is false for a normal account" do
      expect(build(:user, email: "alice@example.com").local_account?).to be false
    end
  end

  describe "#invalidate_all_sessions!" do
    it "rotates jti and clears refresh_token_jti" do
      user = create(:user)
      user.update!(refresh_token_jti: "old-refresh-jti")
      old_jti = user.jti

      user.invalidate_all_sessions!

      expect(user.reload.jti).not_to eq(old_jti)
      expect(user.jti).to be_present
      expect(user.refresh_token_jti).to be_nil
    end
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb`
Expected: FAIL — `undefined method 'local_account?'`

- [ ] **Step 3: 모델 구현**

`backend/app/models/user.rb` — `ROLES` 상수 근처에 추가:

```ruby
  ROLES = %w[admin member].freeze
  LOCAL_EMAIL = "desktop@local".freeze
```

그리고 `admin?`/`member?` 메서드 근처에 추가:

```ruby
  # 로컬 자동로그인 계정(desktop@local) 여부
  def local_account?
    email == LOCAL_EMAIL
  end
```

`revoke_refresh_token!` 메서드 아래에 추가:

```ruby
  # 모든 세션 무효화: jti 회전 → 기존 access token 거부, refresh_token_jti 제거 → refresh 거부
  def invalidate_all_sessions!
    update!(jti: SecureRandom.uuid, refresh_token_jti: nil)
  end
```

- [ ] **Step 4: concern을 상수 참조로 정리**

`backend/app/controllers/concerns/default_user_lookup.rb:23` 의 하드코딩된 이메일을 상수로:

```ruby
  def local_default_user
    User.find_or_create_by!(email: User::LOCAL_EMAIL) do |u|
      u.name = "사용자"
      u.role = "admin"
    end
  end
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb`
Expected: PASS (3 examples)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/models/user.rb backend/app/controllers/concerns/default_user_lookup.rb backend/spec/models/user_spec.rb
git commit -m "feat(backend): add User#invalidate_all_sessions! and local_account? helper"
```

---

## Task 2: Devise 셀프 회원가입 제거

**Files:**
- Modify: `backend/config/routes.rb:5-34`
- Delete: `backend/app/controllers/auth/registrations_controller.rb`
- Delete: `backend/app/controllers/auth/browser_registrations_controller.rb`
- Delete: `backend/app/services/register_form_template.rb`
- Test: `backend/spec/requests/auth/registration_disabled_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/auth/registration_disabled_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "Self-registration disabled", type: :request do
  it "has no JSON self-registration route (POST /auth)" do
    expect {
      Rails.application.routes.recognize_path("/auth", method: :post)
    }.to raise_error(ActionController::RoutingError)
  end

  it "has no HTML register route (GET /auth/web_register)" do
    expect {
      Rails.application.routes.recognize_path("/auth/web_register", method: :get)
    }.to raise_error(ActionController::RoutingError)
  end

  it "still allows login route (POST /auth/login)" do
    expect(
      Rails.application.routes.recognize_path("/auth/login", method: :post)
    ).to include(controller: "auth/sessions", action: "create")
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/auth/registration_disabled_spec.rb`
Expected: FAIL — 첫 두 예제가 라우트를 인식하여 RoutingError를 못 냄

- [ ] **Step 3: 라우트에서 registrations 제거**

`backend/config/routes.rb` 의 `devise_for` 블록을 다음으로 교체:

```ruby
  devise_for :users, path: "auth",
    path_names: { sign_in: "login", sign_out: "logout" },
    skip: [:registrations],
    controllers: {
      sessions: "auth/sessions"
    },
    defaults: { format: :json }
```

같은 파일의 `scope "auth"` 블록에서 web_register 두 줄을 삭제 (web_login은 유지):

```ruby
  scope "auth" do
    get  "web_login", to: "auth/browser_sessions#new",    as: :browser_login
    post "web_login", to: "auth/browser_sessions#create",  as: :browser_login_submit
  end
```

- [ ] **Step 4: 도달 불가가 된 컨트롤러/서비스 삭제**

```bash
git rm backend/app/controllers/auth/registrations_controller.rb \
       backend/app/controllers/auth/browser_registrations_controller.rb \
       backend/app/services/register_form_template.rb
```

`backend/app/services/login_form_template.rb` 에 회원가입 링크가 있으면 제거한다:

Run: `grep -n "web_register\|browser_register\|회원가입\|register" backend/app/services/login_form_template.rb backend/app/controllers/auth/browser_sessions_controller.rb`
링크/참조가 있으면 해당 HTML 라인만 삭제 (없으면 건너뜀).

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/auth/registration_disabled_spec.rb`
Expected: PASS (3 examples)

- [ ] **Step 6: 전체 auth/server-mode 회귀 확인**

Run: `cd backend && bundle exec rspec spec/requests/server_local_mode_spec.rb spec/requests/auth`
Expected: PASS (로그인/모드 분기 동작 유지)

- [ ] **Step 7: 커밋**

```bash
git add backend/config/routes.rb backend/spec/requests/auth/registration_disabled_spec.rb
git commit -m "feat(backend): disable Devise self-registration (admin-only user creation)"
```

---

## Task 3: 관리자 — desktop@local 보호 + 이메일 수정

**Files:**
- Modify: `backend/app/controllers/api/v1/admin/users_controller.rb`
- Test: `backend/spec/requests/api/v1/admin/users_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/api/v1/admin/users_spec.rb` 의 `describe "PUT /api/v1/admin/users/:id"` 안에 추가:

```ruby
      it "updates email" do
        put "/api/v1/admin/users/#{member.id}", params: { email: "renamed@example.com" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["user"]["email"]).to eq("renamed@example.com")
      end

      it "refuses to demote the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        put "/api/v1/admin/users/#{local.id}", params: { role: "member" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(local.reload.role).to eq("admin")
      end
```

`describe "DELETE /api/v1/admin/users/:id"` 안에 추가:

```ruby
      it "refuses to delete the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        expect {
          delete "/api/v1/admin/users/#{local.id}"
        }.not_to change(User, :count)

        expect(response).to have_http_status(:forbidden)
      end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/admin/users_spec.rb -e "email" -e "local account"`
Expected: FAIL — email 미반영, local 강등/삭제가 허용됨

- [ ] **Step 3: 컨트롤러 구현**

`backend/app/controllers/api/v1/admin/users_controller.rb` 수정:

`update` 교체:

```ruby
        def update
          if @user.local_account? && update_params[:role].present? && update_params[:role] != "admin"
            return render json: { error: "로컬 계정의 역할은 변경할 수 없습니다." }, status: :forbidden
          end

          if @user.update(update_params)
            render json: { user: user_json(@user) }
          else
            render json: { errors: @user.errors.full_messages }, status: :unprocessable_entity
          end
        end
```

`destroy` 의 자기삭제 가드 바로 아래에 로컬 계정 가드 추가:

```ruby
        def destroy
          if @user == current_user
            render json: { error: "Cannot delete yourself" }, status: :forbidden
            return
          end

          if @user.local_account?
            render json: { error: "로컬 계정은 삭제할 수 없습니다." }, status: :forbidden
            return
          end

          @user.destroy
          head :no_content
        end
```

`update_params` 에 `:email` 추가:

```ruby
        def update_params
          params.permit(:name, :role, :email)
        end
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/admin/users_spec.rb`
Expected: PASS (기존 + 신규 전부)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/admin/users_controller.rb backend/spec/requests/api/v1/admin/users_spec.rb
git commit -m "feat(backend): admin can edit email; protect local account from delete/demote"
```

---

## Task 4: 관리자 비밀번호 초기화 엔드포인트

**Files:**
- Modify: `backend/config/routes.rb` (admin users member route)
- Modify: `backend/app/controllers/api/v1/admin/users_controller.rb`
- Test: `backend/spec/requests/api/v1/admin/users_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/api/v1/admin/users_spec.rb` 최상단 `let` 아래에 비번/로그인 헬퍼가 없으면 추가하고, 새 describe 블록을 파일 끝(최상위 describe 안)에 추가:

```ruby
  describe "POST /api/v1/admin/users/:id/reset_password" do
    include_context "server mode"
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    def login(user, password = "password123")
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      response.parsed_body["access_token"]
    end

    it "resets password, returns temp, and invalidates the target's sessions" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      member_token = login(member_pw)
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["temp_password"]).to be_present
      expect(response.parsed_body["temp_password"].length).to be >= 12

      # 대상의 기존 토큰은 거부된다
      get "/api/v1/meetings",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "lets the target log in with the temp password" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json
      temp = response.parsed_body["temp_password"]

      post "/auth/login", params: { user: { email: member_pw.email, password: temp } }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 403 for a member caller" do
      member_pw = create(:user, password: "password123")
      target = create(:user)
      member_token = login(member_pw)

      post "/api/v1/admin/users/#{target.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/admin/users_spec.rb -e "reset_password"`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: 라우트 추가**

`backend/config/routes.rb` 의 `namespace :admin` 블록 교체:

```ruby
      namespace :admin do
        resources :users, only: %i[index create update destroy] do
          member do
            post :reset_password
          end
        end
      end
```

- [ ] **Step 4: 컨트롤러 구현**

`backend/app/controllers/api/v1/admin/users_controller.rb`:

`before_action :set_user` 의 액션 목록에 `reset_password` 추가:

```ruby
        before_action :set_user, only: %i[update destroy reset_password]
```

`destroy` 아래(private 위)에 액션 추가:

```ruby
        def reset_password
          temp_password = SecureRandom.alphanumeric(12)
          @user.update!(password: temp_password)
          @user.invalidate_all_sessions!
          render json: { temp_password: temp_password }
        end
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/admin/users_spec.rb`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/config/routes.rb backend/app/controllers/api/v1/admin/users_controller.rb backend/spec/requests/api/v1/admin/users_spec.rb
git commit -m "feat(backend): admin reset_password endpoint with temp password + session invalidation"
```

---

## Task 5: 본인 비밀번호 변경 엔드포인트

**Files:**
- Modify: `backend/config/routes.rb` (namespace :user)
- Create: `backend/app/controllers/api/v1/user/passwords_controller.rb`
- Test: `backend/spec/requests/api/v1/user/passwords_spec.rb`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/spec/requests/api/v1/user/passwords_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "Api::V1::User::Passwords", type: :request do
  include_context "server mode"
  let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }
  let(:member) { create(:user, password: "password123") }

  def login(user, password = "password123")
    post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
    response.parsed_body["access_token"]
  end

  it "changes password, reissues working tokens, rejects the old token" do
    token = login(member)

    patch "/api/v1/user/password",
      params: { current_password: "password123", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json

    expect(response).to have_http_status(:ok)
    new_access = response.parsed_body["access_token"]
    expect(new_access).to be_present
    expect(response.parsed_body["refresh_token"]).to be_present

    # 기존 토큰 거부
    get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unauthorized)

    # 새 토큰 동작
    get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{new_access}"), as: :json
    expect(response).to have_http_status(:ok)

    # 새 비밀번호로 로그인 가능
    post "/auth/login", params: { user: { email: member.email, password: "newpassword456" } }, as: :json
    expect(response).to have_http_status(:ok)
  end

  it "returns 422 when current password is wrong" do
    token = login(member)
    patch "/api/v1/user/password",
      params: { current_password: "wrongpass", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "returns 422 when confirmation does not match" do
    token = login(member)
    patch "/api/v1/user/password",
      params: { current_password: "password123", new_password: "newpassword456", new_password_confirmation: "different789" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "returns 403 for the local account (loopback, no JWT)" do
    patch "/api/v1/user/password",
      params: { current_password: "x", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: { "REMOTE_ADDR" => "127.0.0.1" }, as: :json
    expect(response).to have_http_status(:forbidden)
  end
end
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/passwords_spec.rb`
Expected: FAIL — 라우트/컨트롤러 없음

- [ ] **Step 3: 라우트 추가**

`backend/config/routes.rb` 의 `namespace :user` 블록에 한 줄 추가:

```ruby
      namespace :user do
        resource :llm_settings, only: [:show, :update] do
          post :test, on: :collection
          patch :toggle, on: :collection
        end
        resource :password, only: [:update]
      end
```

- [ ] **Step 4: 컨트롤러 구현**

`backend/app/controllers/api/v1/user/passwords_controller.rb`:

```ruby
module Api
  module V1
    module User
      class PasswordsController < ApplicationController
        before_action :authenticate_user!

        # PATCH /api/v1/user/password
        def update
          if current_user.local_account?
            return render json: { error: "로컬 계정은 비밀번호를 변경할 수 없습니다." }, status: :forbidden
          end

          unless current_user.valid_password?(params[:current_password])
            return render json: { error: "현재 비밀번호가 일치하지 않습니다." }, status: :unprocessable_entity
          end

          if params[:new_password].blank? || params[:new_password] != params[:new_password_confirmation]
            return render json: { error: "새 비밀번호가 일치하지 않습니다." }, status: :unprocessable_entity
          end

          if current_user.update(password: params[:new_password])
            current_user.invalidate_all_sessions!
            new_refresh_jti = current_user.generate_refresh_token_jti!
            render json: {
              access_token: JwtService.encode_access_token(current_user),
              refresh_token: JwtService.encode_refresh_token(current_user, new_refresh_jti)
            }
          else
            render json: { errors: current_user.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end
    end
  end
end
```

주: 이 컨트롤러는 `User` 모델 상수를 직접 참조하지 않는다 (`Api::V1::User` 모듈과 충돌 회피). `current_user`/`JwtService`만 사용한다.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/passwords_spec.rb`
Expected: PASS (4 examples)

- [ ] **Step 6: 백엔드 전체 스위트 회귀**

Run: `cd backend && bundle exec rspec`
Expected: PASS (전체)

- [ ] **Step 7: 커밋**

```bash
git add backend/config/routes.rb backend/app/controllers/api/v1/user/passwords_controller.rb backend/spec/requests/api/v1/user/passwords_spec.rb
git commit -m "feat(backend): self-service password change with current-password check + session reissue"
```

---

## Task 6: 프론트 API — adminUsers (reset/email)

**Files:**
- Modify: `frontend/src/api/adminUsers.ts`
- Test: `frontend/src/api/adminUsers.test.ts` (없으면 생성)

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/api/adminUsers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const post = vi.fn()
const put = vi.fn()
vi.mock('./client', () => ({
  default: { post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}))

import { resetAdminUserPassword, updateAdminUser } from './adminUsers'

beforeEach(() => {
  post.mockReset()
  put.mockReset()
})

describe('resetAdminUserPassword', () => {
  it('POSTs to reset_password and returns temp_password', async () => {
    post.mockReturnValue({ json: () => Promise.resolve({ temp_password: 'abc123XYZ789' }) })

    const result = await resetAdminUserPassword(42)

    expect(post).toHaveBeenCalledWith('admin/users/42/reset_password')
    expect(result.temp_password).toBe('abc123XYZ789')
  })
})

describe('updateAdminUser', () => {
  it('sends email when provided', async () => {
    put.mockReturnValue({ json: () => Promise.resolve({ user: { id: 1, email: 'new@x.com', name: 'A', role: 'member', created_at: '', updated_at: '' } }) })

    await updateAdminUser(1, { email: 'new@x.com' })

    expect(put).toHaveBeenCalledWith('admin/users/1', { json: { email: 'new@x.com' } })
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/api/adminUsers.test.ts`
Expected: FAIL — `resetAdminUserPassword` export 없음

- [ ] **Step 3: 구현**

`frontend/src/api/adminUsers.ts` 의 `updateAdminUser` 시그니처에 `email?` 추가:

```ts
export async function updateAdminUser(
  id: number,
  params: { name?: string; role?: string; email?: string },
): Promise<AdminUser> {
  const res = await apiClient
    .put(`admin/users/${id}`, { json: params })
    .json<{ user: AdminUser }>()
  return res.user
}
```

파일 끝에 추가:

```ts
export async function resetAdminUserPassword(
  id: number,
): Promise<{ temp_password: string }> {
  return apiClient
    .post(`admin/users/${id}/reset_password`)
    .json<{ temp_password: string }>()
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/api/adminUsers.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/api/adminUsers.ts frontend/src/api/adminUsers.test.ts
git commit -m "feat(frontend): adminUsers API — resetAdminUserPassword + email update"
```

---

## Task 7: 프론트 API — account.changePassword

**Files:**
- Create: `frontend/src/api/account.ts`
- Test: `frontend/src/api/account.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/api/account.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const patch = vi.fn()
vi.mock('./client', () => ({
  default: { patch: (...a: unknown[]) => patch(...a) },
}))

import { changePassword } from './account'

beforeEach(() => patch.mockReset())

describe('changePassword', () => {
  it('PATCHes user/password and returns new tokens', async () => {
    patch.mockReturnValue({
      json: () => Promise.resolve({ access_token: 'AAA', refresh_token: 'RRR' }),
    })

    const result = await changePassword({
      current_password: 'old',
      new_password: 'newpassword456',
      new_password_confirmation: 'newpassword456',
    })

    expect(patch).toHaveBeenCalledWith('user/password', {
      json: {
        current_password: 'old',
        new_password: 'newpassword456',
        new_password_confirmation: 'newpassword456',
      },
    })
    expect(result).toEqual({ access_token: 'AAA', refresh_token: 'RRR' })
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/api/account.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/api/account.ts`:

```ts
import apiClient from './client'

export interface ChangePasswordParams {
  current_password: string
  new_password: string
  new_password_confirmation: string
}

export interface ChangePasswordResponse {
  access_token: string
  refresh_token: string
}

export async function changePassword(
  params: ChangePasswordParams,
): Promise<ChangePasswordResponse> {
  return apiClient
    .patch('user/password', { json: params })
    .json<ChangePasswordResponse>()
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/api/account.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/api/account.ts frontend/src/api/account.test.ts
git commit -m "feat(frontend): account API — changePassword"
```

---

## Task 8: 본인 비밀번호 변경 UI (PasswordChangeSection)

**Files:**
- Create: `frontend/src/components/settings/PasswordChangeSection.tsx`
- Modify: `frontend/src/components/settings/SettingsContent.tsx`
- Test: `frontend/src/components/settings/PasswordChangeSection.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/components/settings/PasswordChangeSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const changePassword = vi.fn()
vi.mock('../../api/account', () => ({ changePassword: (...a: unknown[]) => changePassword(...a) }))

const setTokens = vi.fn()
vi.mock('../../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ setTokens }) },
}))

import PasswordChangeSection from './PasswordChangeSection'

beforeEach(() => {
  changePassword.mockReset()
  setTokens.mockReset()
})

describe('PasswordChangeSection', () => {
  it('submits change and stores reissued tokens', async () => {
    changePassword.mockResolvedValue({ access_token: 'AAA', refresh_token: 'RRR' })
    render(<PasswordChangeSection />)

    fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'old' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'newpassword456' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'newpassword456' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        current_password: 'old',
        new_password: 'newpassword456',
        new_password_confirmation: 'newpassword456',
      })
      expect(setTokens).toHaveBeenCalledWith('AAA', 'RRR')
    })
  })

  it('shows error when confirmation mismatches (no API call)', async () => {
    render(<PasswordChangeSection />)

    fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'old' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'newpassword456' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'mismatch' } })
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(await screen.findByText('새 비밀번호가 일치하지 않습니다.')).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/PasswordChangeSection.test.tsx`
Expected: FAIL — 컴포넌트 없음

- [ ] **Step 3: 컴포넌트 구현**

`frontend/src/components/settings/PasswordChangeSection.tsx`:

```tsx
import { useState } from 'react'
import { HTTPError } from 'ky'
import { changePassword } from '../../api/account'
import { useAuthStore } from '../../stores/authStore'

export default function PasswordChangeSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (next !== confirm) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setSaving(true)
    try {
      const tokens = await changePassword({
        current_password: current,
        new_password: next,
        new_password_confirmation: confirm,
      })
      useAuthStore.getState().setTokens(tokens.access_token, tokens.refresh_token)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSuccess('비밀번호가 변경되었습니다. 다른 기기는 다시 로그인해야 합니다.')
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as Record<string, string>
        setError(body.error ?? '비밀번호 변경에 실패했습니다.')
      } else {
        setError('비밀번호 변경에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">비밀번호 변경</h2>
      <p className="text-sm text-muted-foreground mb-4">
        변경하면 현재 기기를 제외한 모든 로그인 세션이 만료됩니다.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium mb-1">현재 비밀번호</label>
          <input
            id="current-password"
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium mb-1">새 비밀번호</label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="6자 이상"
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium mb-1">새 비밀번호 확인</label>
          <input
            id="confirm-password"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {saving ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: SettingsContent에 조건부 삽입**

`frontend/src/components/settings/SettingsContent.tsx` 상단 import에 추가:

```tsx
import PasswordChangeSection from './PasswordChangeSection'
```

`export default function SettingsContent()` 본문 상단(`const showAdminSettings = ...` 아래)에 노출 조건 추가:

```tsx
  // 로컬모드/로컬계정(desktop@local)은 자동 로그인이라 비밀번호 변경 불필요
  const showPasswordSection = getMode() !== 'local' && user?.email !== 'desktop@local'
```

`return (...)` 안 `<UserLlmSettings />` 바로 위에 삽입:

```tsx
      {showPasswordSection && <PasswordChangeSection />}

      {/* 내 LLM 설정 (사용자 개인) */}
      <UserLlmSettings />
```

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/components/settings/PasswordChangeSection.test.tsx`
Expected: PASS (2 examples)

- [ ] **Step 6: 타입체크 + 커밋**

Run: `cd frontend && npx tsc --noEmit`
Expected: 오류 없음

```bash
git add frontend/src/components/settings/PasswordChangeSection.tsx frontend/src/components/settings/PasswordChangeSection.test.tsx frontend/src/components/settings/SettingsContent.tsx
git commit -m "feat(frontend): self password-change section in settings (hidden for local account)"
```

---

## Task 9: 관리자 패널 — 비번 초기화 + 이메일 편집

**Files:**
- Modify: `frontend/src/components/settings/UserManagementPanel.tsx`

- [ ] **Step 1: 임시비번 표시 모달 + 초기화 다이얼로그 추가**

`frontend/src/components/settings/UserManagementPanel.tsx` 상단 import 수정:

```tsx
import { Trash2, Plus, UserPlus, KeyRound, Pencil } from 'lucide-react'
import {
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetAdminUserPassword,
} from '../../api/adminUsers'
```

`DeleteConfirmDialog` 정의 아래에 두 컴포넌트 추가:

```tsx
// ── 비밀번호 초기화 다이얼로그 ──
function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser
  onClose: () => void
}) {
  const [working, setWorking] = useState(false)
  const [temp, setTemp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleReset = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await resetAdminUserPassword(user.id)
      setTemp(res.temp_password)
    } catch {
      setError('비밀번호 초기화에 실패했습니다.')
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = async () => {
    if (!temp) return
    await navigator.clipboard.writeText(temp)
    setCopied(true)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl border border-gray-100 p-6 mx-4">
        <h3 className="text-lg font-semibold mb-2">비밀번호 초기화</h3>
        {temp === null ? (
          <>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{user.name}</strong> ({user.email})의 비밀번호를 임시 비밀번호로 재설정합니다.
              해당 사용자의 모든 세션이 만료됩니다.
            </p>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 min-h-[44px]">취소</button>
              <button onClick={handleReset} disabled={working} className="px-4 py-2 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 min-h-[44px]">
                {working ? '처리 중...' : '초기화'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-3">
              임시 비밀번호입니다. 이 창을 닫으면 다시 볼 수 없으니 사용자에게 전달하세요.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 rounded-md bg-gray-100 px-3 py-2 text-sm font-mono break-all">{temp}</code>
              <button onClick={handleCopy} className="px-3 py-2 rounded-md text-sm font-medium border border-gray-300 hover:bg-gray-50 min-h-[44px]">
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 min-h-[44px]">닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 사용자 편집(이름/이메일) 다이얼로그 ──
function EditUserDialog({
  user,
  onClose,
  onUpdated,
}: {
  user: AdminUser
  onClose: () => void
  onUpdated: (u: AdminUser) => void
}) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const updated = await updateAdminUser(user.id, { name, email })
      onUpdated(updated)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = (await err.response.json().catch(() => ({}))) as Record<string, string[]>
        setError(body.errors?.join(', ') ?? '수정에 실패했습니다.')
      } else {
        setError('수정에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-gray-100 p-6 mx-4">
        <h3 className="text-lg font-semibold mb-4">사용자 수정</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">이름</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 min-h-[44px]">취소</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: 메인 패널에 상태 + 행 버튼 연결**

`UserManagementPanel` 컴포넌트의 상태 선언부에 추가:

```tsx
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
```

테이블 행의 액션 `<td className="py-3">` 블록(현재 삭제 버튼만 있는 셀)을 교체:

```tsx
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditTarget(user)}
                            className="p-2.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                            title="이름/이메일 수정"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {!user.email.endsWith('@local') && (
                            <button
                              onClick={() => setResetTarget(user)}
                              className="p-2.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-all"
                              title="비밀번호 초기화"
                            >
                              <KeyRound className="w-4 h-4" />
                            </button>
                          )}
                          {!isSelf && !user.email.endsWith('@local') && (
                            <button
                              onClick={() => setDeleteTarget(user)}
                              className="p-2.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                              title="사용자 삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
```

패널 JSX 하단(삭제 다이얼로그 렌더 뒤)에 추가:

```tsx
      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={(u) => {
            setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))
            setEditTarget(null)
          }}
        />
      )}
```

- [ ] **Step 3: 타입체크 + lint**

Run: `cd frontend && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: 기존 프론트 스위트 회귀**

Run: `cd frontend && npx vitest run`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/settings/UserManagementPanel.tsx
git commit -m "feat(frontend): admin panel — reset password modal + edit name/email"
```

---

## Task 10: 통합 검증 (수동)

**Files:** 없음 (실행 검증)

- [ ] **Step 1: 백엔드 server_mode로 기동**

Run: `cd backend && SERVER_MODE=true bin/rails server -b 0.0.0.0 -p 13323`
주의: `SERVER_MODE=true` 누락 시 전부 로컬모드(desktop@local)로 처리됨 — 반드시 포함.

- [ ] **Step 2: 로컬(맥 본체) admin 흐름 확인**
  - 앱/loopback에서 설정 → 사용자 관리 진입 (desktop@local = admin).
  - 사용자 추가 → 새 member 생성.
  - 새 member 행에서 "비밀번호 초기화" → 임시 비번 모달 표시 + 복사.
  - "이름/이메일 수정" → 이메일 변경 반영.
  - desktop@local 행에는 삭제 버튼 없음, role 토글 비활성.

- [ ] **Step 3: 원격 사용자 흐름 확인**
  - 다른 기기/브라우저에서 발급된 계정 + 임시 비번으로 로그인.
  - 설정 → "비밀번호 변경" 섹션 노출 확인 (desktop@local에는 미노출).
  - 현재 비번(임시) + 새 비번으로 변경 → 성공, 로그인 유지.
  - 같은 계정의 다른 기기 세션은 401 → 재로그인 요구됨.

- [ ] **Step 4: 셀프가입 차단 확인**
  - `curl -i -X POST http://localhost:13323/auth -d '{}' -H 'Content-Type: application/json'` → 라우트 없음(404/RoutingError).

---

## Self-Review (작성자 체크 완료)

- **Spec coverage:** 회원가입 차단(Task 2) · 로컬=admin/보호(Task 1·3) · 세션 무효화 헬퍼(Task 1) · 본인 변경(Task 5·7·8) · admin 초기화(Task 4·6·9) · 이메일 수정(Task 3·6·9) — 모든 spec 섹션에 대응 태스크 존재.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함.
- **Type consistency:** `invalidate_all_sessions!`, `local_account?`, `resetAdminUserPassword`, `changePassword`, `ChangePasswordResponse{access_token,refresh_token}` 명칭이 백엔드 응답·프론트 호출·테스트 전반에서 일치.
- **주의(실행자):** 백엔드 password/admin spec은 실제 JWT를 발급하므로 `include_context "server mode"` + 비-loopback `REMOTE_ADDR`이 필수. `login_as`(current_user 스텁)는 토큰 무효화 검증과 양립 불가하므로 해당 spec에서는 쓰지 말 것.
