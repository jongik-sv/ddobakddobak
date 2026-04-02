# TSK-01-01: Devise JWT 인증 구현 - 설계 문서

> **status:** design
> **updated:** 2026-04-02
> **depends:** -
> **branch:** dev/WP-01

---

## 1. 아키텍처 개요

### 1.1 현재 상태

- User 모델은 Devise **없이** 동작 중 (직접 `encrypted_password`, `jti` 관리)
- `ApplicationController#authenticate_user!`는 `DefaultUserLookup`으로 `desktop@local` 유저를 자동 반환
- Gemfile에 `devise`, `devise-jwt` 없음
- `bcrypt` gem 주석 처리됨

### 1.2 목표 상태

```
[클라이언트]                        [Rails API]
    │                                    │
    ├─ POST /auth/login ────────────────→│ Devise::SessionsController (override)
    │  {email, password}                 │  → bcrypt 검증
    │← 200 {access_token, refresh_token} │  → JWT 발급 (access + refresh)
    │                                    │
    ├─ GET /api/v1/meetings ────────────→│ authenticate_user! (JWT 검증)
    │  Authorization: Bearer <access>    │  → Warden + devise-jwt
    │← 200 [meetings...]                 │
    │                                    │
    ├─ POST /auth/refresh ──────────────→│ Auth::SessionsController#refresh
    │  {refresh_token}                   │  → refresh_token_jti 검증
    │← 200 {access_token}               │  → 새 Access Token 발급
    │                                    │
    └─ DELETE /auth/logout ─────────────→│ Devise::SessionsController#destroy
       Authorization: Bearer <access>    │  → jti 폐기 (revocation)
```

### 1.3 설계 원칙

- **devise-jwt 활용**: WBS/TRD 요구사항에 따라 `devise` + `devise-jwt` gem 사용
- **기존 코드 최소 변경**: User 모델에 Devise 모듈 추가, 기존 필드(email, encrypted_password, jti) 재활용
- **마이그레이션 안전성**: 기존 users 테이블에 컬럼 추가만 수행 (테이블 재생성 없음)
- **하위 호환**: `SERVER_MODE=false` (기본값)에서는 기존 동작 100% 유지

---

## 2. Gem 의존성

### 2.1 추가할 Gem

```ruby
# Gemfile
gem "devise"                  # 인증 프레임워크
gem "devise-jwt"              # JWT 전략 (Warden 통합)
gem "bcrypt", "~> 3.1.7"      # 비밀번호 해싱 (주석 해제)
```

### 2.2 Gem 버전 호환성

| Gem | 버전 | Rails 8.1 호환 | 비고 |
|-----|------|----------------|------|
| devise | >= 4.9 | O | API 모드에서는 일부 미들웨어 수동 설정 필요 |
| devise-jwt | >= 0.12 | O | jwt gem 의존 |
| bcrypt | ~> 3.1.7 | O | Gemfile에 이미 존재 (주석) |

---

## 3. 파일 변경 목록

### 3.1 신규 생성

| 파일 | 목적 |
|------|------|
| `config/initializers/devise.rb` | Devise 설정 (JWT secret, 만료 등) |
| `config/initializers/devise_jwt.rb` | devise-jwt dispatch/revocation 규칙 |
| `app/controllers/auth/sessions_controller.rb` | 로그인/로그아웃/리프레시 컨트롤러 |
| `db/migrate/XXX_add_devise_and_refresh_token_to_users.rb` | 마이그레이션 |
| `spec/requests/auth/sessions_spec.rb` | 인증 API 테스트 |
| `spec/models/user_jwt_spec.rb` | User JWT 관련 모델 테스트 |

### 3.2 수정

| 파일 | 변경 내용 |
|------|----------|
| `Gemfile` | devise, devise-jwt, bcrypt 추가 |
| `app/models/user.rb` | Devise 모듈 추가, JTIMatcher 전략 |
| `config/routes.rb` | `devise_for :users` + auth 라우트 |
| `app/controllers/application_controller.rb` | JWT `authenticate_user!` 분기 |
| `spec/rails_helper.rb` | Devise 테스트 헬퍼 추가 |
| `spec/factories/users.rb` | password 필드 추가 |

---

## 4. DB 마이그레이션

### 4.1 마이그레이션: `AddDeviseAndRefreshTokenToUsers`

```ruby
class AddDeviseAndRefreshTokenToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users do |t|
      # Refresh Token 무효화용 JTI
      t.string :refresh_token_jti
    end

    add_index :users, :refresh_token_jti, unique: true
  end
end
```

### 4.2 기존 필드 재활용 분석

| 필드 | 현재 상태 | Devise 필요 | 변경 |
|------|----------|-------------|------|
| `email` | 존재 (unique index) | `database_authenticatable` | 없음 |
| `encrypted_password` | 존재 (`SecureRandom.hex`) | `database_authenticatable` | Devise가 bcrypt로 관리 |
| `jti` | 존재 (unique index) | `devise-jwt` JTIMatcher | 없음 (Access Token 폐기용으로 사용) |
| `refresh_token_jti` | 없음 | Refresh Token 폐기용 | **추가** |

**중요**: 기존 `encrypted_password`는 `SecureRandom.hex(32)`로 채워져 있어 bcrypt 형식이 아니다.
기존 `desktop@local` 유저의 패스워드는 로컬 모드에서 사용하지 않으므로 문제 없다.
서버 모드에서 새로 생성하는 유저만 bcrypt 패스워드를 갖게 된다.

---

## 5. User 모델 변경

### 5.1 변경 후 User 모델

```ruby
class User < ApplicationRecord
  # ── Devise ──
  devise :database_authenticatable, :jwt_authenticatable,
         jwt_revocation_strategy: self

  # ── devise-jwt JTIMatcher 전략 ──
  include Devise::JWT::RevocationStrategies::JTIMatcher

  validates :name, presence: true

  before_validation :set_defaults, on: :create

  # Refresh Token jti 관리
  def generate_refresh_token_jti!
    update!(refresh_token_jti: SecureRandom.uuid)
    refresh_token_jti
  end

  def revoke_refresh_token!
    update!(refresh_token_jti: nil)
  end

  private

  def set_defaults
    self.jti = SecureRandom.uuid if jti.blank?
  end
end
```

### 5.2 변경 사항 상세

1. **Devise 모듈 추가**: `database_authenticatable` (이메일+비밀번호 인증), `jwt_authenticatable` (JWT 전략)
2. **JTIMatcher 전략**: `jti` 컬럼을 사용하여 Access Token 무효화. 로그아웃 시 `jti`를 재생성하면 기존 토큰이 무효화됨
3. **`encrypted_password` 자동 생성 제거**: Devise가 `password=` setter로 bcrypt 해싱을 처리하므로 `set_defaults`에서 `encrypted_password` 설정 코드 제거
4. **`refresh_token_jti` 메서드**: Refresh Token 발급/폐기를 위한 편의 메서드

---

## 6. Devise 설정

### 6.1 config/initializers/devise.rb

```ruby
Devise.setup do |config|
  config.mailer_sender = "noreply@ddobak.local"

  require "devise/orm/active_record"

  # ── API 모드 설정 ──
  config.navigational_formats = []       # API 전용 (리다이렉트 없음)
  config.sign_out_via = :delete

  # ── JWT 설정 ──
  config.jwt do |jwt|
    jwt.secret = Rails.application.credentials.devise_jwt_secret_key ||
                 ENV.fetch("DEVISE_JWT_SECRET_KEY") { Rails.application.secret_key_base }
    jwt.expiration_time = 24.hours.to_i   # Access Token 만료: 24시간
    jwt.dispatch_requests = [
      ["POST", %r{^/auth/login$}]
    ]
    jwt.revocation_requests = [
      ["DELETE", %r{^/auth/logout$}]
    ]
  end
end
```

### 6.2 JWT 토큰 구조

#### Access Token (devise-jwt 자동 발급)

```json
{
  "sub": "user_id",
  "jti": "unique-jti-from-users-table",
  "scp": "user",
  "iat": 1712000000,
  "exp": 1712086400
}
```

- 만료: 24시간
- 폐기: `jti` 컬럼 값 변경 시 기존 토큰 무효화 (JTIMatcher)

#### Refresh Token (수동 발급)

```json
{
  "sub": "user_id",
  "jti": "refresh-token-jti-value",
  "type": "refresh",
  "iat": 1712000000,
  "exp": 1714592000
}
```

- 만료: 30일
- 폐기: `refresh_token_jti` 컬럼 nil로 설정
- devise-jwt와 별도로 `JWT.encode/decode`로 수동 관리

---

## 7. 컨트롤러 설계

### 7.1 Auth::SessionsController

```ruby
# app/controllers/auth/sessions_controller.rb
class Auth::SessionsController < Devise::SessionsController
  respond_to :json

  # POST /auth/login
  def create
    self.resource = warden.authenticate!(auth_options)
    sign_in(resource_name, resource)

    refresh_jti = resource.generate_refresh_token_jti!
    refresh_token = JwtService.encode_refresh_token(resource, refresh_jti)

    render json: {
      access_token: request.env["warden-jwt_auth.token"],
      refresh_token: refresh_token,
      user: { id: resource.id, email: resource.email, name: resource.name }
    }
  end

  # DELETE /auth/logout
  def destroy
    # devise-jwt가 JTIMatcher로 jti를 재생성 → Access Token 무효화
    current_user.revoke_refresh_token!
    sign_out(resource_name)
    render json: { message: "logged out" }, status: :ok
  end

  # POST /auth/refresh
  def refresh
    payload = JwtService.decode_refresh_token(params[:refresh_token])
    user = User.find(payload["sub"])

    if user.refresh_token_jti == payload["jti"]
      # Access Token 재발급 (jti 유지 → 기존 Access Token도 유효)
      new_access_token = JwtService.encode_access_token(user)
      render json: { access_token: new_access_token }
    else
      render json: { error: "Invalid refresh token" }, status: :unauthorized
    end
  rescue JWT::DecodeError, JWT::ExpiredSignature, ActiveRecord::RecordNotFound
    render json: { error: "Invalid refresh token" }, status: :unauthorized
  end

  private

  def respond_with(resource, _opts = {})
    # Devise 기본 동작 override (create에서 직접 render)
  end

  def respond_to_on_destroy
    # Devise 기본 동작 override (destroy에서 직접 render)
  end
end
```

### 7.2 JwtService

```ruby
# app/services/jwt_service.rb
class JwtService
  SECRET = -> { Devise::JWT.config.secret }
  REFRESH_EXPIRATION = 30.days.to_i

  class << self
    # Refresh Token 인코딩
    def encode_refresh_token(user, jti)
      payload = {
        sub: user.id,
        jti: jti,
        type: "refresh",
        iat: Time.current.to_i,
        exp: REFRESH_EXPIRATION.from_now.to_i
      }
      JWT.encode(payload, SECRET.call, "HS256")
    end

    # Refresh Token 디코딩 (만료/서명 검증 포함)
    def decode_refresh_token(token)
      decoded = JWT.decode(token, SECRET.call, true, {
        algorithm: "HS256",
        verify_expiration: true
      })
      payload = decoded.first

      raise JWT::DecodeError, "Not a refresh token" unless payload["type"] == "refresh"

      payload
    end

    # Access Token 수동 발급 (refresh 시)
    def encode_access_token(user)
      payload = {
        sub: user.id,
        jti: user.jti,
        scp: "user",
        iat: Time.current.to_i,
        exp: Devise::JWT.config.expiration_time.from_now.to_i
      }
      JWT.encode(payload, SECRET.call, "HS256")
    end
  end
end
```

### 7.3 ApplicationController 변경

```ruby
class ApplicationController < ActionController::API
  include ActionController::MimeResponds

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  private

  def authenticate_user!
    if server_mode?
      # 서버 모드: devise-jwt 인증 (Warden)
      # → Devise::JWT가 Authorization 헤더의 Bearer 토큰 검증
      warden.authenticate!(scope: :user)
      @current_user = warden.user(:user)
    else
      # 로컬 모드: 기존 동작 유지
      @current_user = default_user
    end
    true
  end

  def current_user
    @current_user ||= if server_mode?
      warden.user(:user)
    else
      default_user
    end
  end

  def server_mode?
    ENV["SERVER_MODE"] == "true"
  end

  def default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end
end
```

**참고**: `DefaultUserLookup` concern은 `default_user` 메서드를 ApplicationController로 인라인화하고,
concern은 제거하거나 빈 모듈로 둔다.
이 변경은 TSK-01-03 (서버/로컬 모드 분기)에서 정식으로 수행한다.
TSK-01-01에서는 `server_mode?` 분기를 `authenticate_user!`와 `current_user`에만 적용한다.

---

## 8. 라우팅

### 8.1 routes.rb 변경

```ruby
Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check
  mount ActionCable.server => "/cable"

  # ── 인증 (Devise + JWT) ──
  devise_for :users, path: "auth",
    path_names: { sign_in: "login", sign_out: "logout" },
    controllers: { sessions: "auth/sessions" },
    defaults: { format: :json }

  # Refresh Token 엔드포인트 (Devise 라우트 외부)
  post "auth/refresh", to: "auth/sessions#refresh"

  # ── API v1 ──
  namespace :api do
    namespace :v1 do
      # ... (기존 라우트 그대로)
    end
  end
end
```

### 8.2 생성되는 라우트

| Method | Path | Controller#Action | 비고 |
|--------|------|-------------------|------|
| POST | `/auth/login` | `auth/sessions#create` | Devise sign_in |
| DELETE | `/auth/logout` | `auth/sessions#destroy` | Devise sign_out |
| POST | `/auth/refresh` | `auth/sessions#refresh` | 수동 라우트 |

---

## 9. API 엔드포인트 상세

### 9.1 POST /auth/login

**요청**
```json
{
  "user": {
    "email": "user@example.com",
    "password": "password123"
  }
}
```

**성공 응답 (200)**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "홍길동"
  }
}
```

**실패 응답 (401)**
```json
{
  "error": "Invalid Email or password."
}
```

### 9.2 POST /auth/refresh

**요청**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**성공 응답 (200)**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**실패 응답 (401)**
```json
{
  "error": "Invalid refresh token"
}
```

### 9.3 DELETE /auth/logout

**요청**
```
Authorization: Bearer <access_token>
```

**성공 응답 (200)**
```json
{
  "message": "logged out"
}
```

---

## 10. JWT 토큰 흐름

### 10.1 로그인 → API 호출 → 토큰 갱신 → 로그아웃

```
[1] POST /auth/login
    → Devise가 email+password 검증 (bcrypt)
    → devise-jwt가 Access Token 발급 (users.jti 참조)
    → 컨트롤러가 Refresh Token 발급 (users.refresh_token_jti 저장)
    → 응답: { access_token, refresh_token, user }

[2] GET /api/v1/meetings (인증된 요청)
    → Authorization: Bearer <access_token>
    → devise-jwt가 토큰 디코딩
    → JTIMatcher: 토큰의 jti == users.jti? → 유효
    → warden.user(:user) = User 인스턴스
    → authenticate_user! 통과

[3] Access Token 만료 (24시간 후)
    → GET /api/v1/meetings → 401 Unauthorized
    → 클라이언트: POST /auth/refresh { refresh_token }
    → 서버: refresh_token 디코딩 → refresh_token_jti 일치 확인
    → 새 Access Token 발급 (같은 users.jti 사용)
    → 응답: { access_token }

[4] DELETE /auth/logout
    → devise-jwt JTIMatcher: users.jti를 새 UUID로 변경
    → 기존 Access Token 무효화 (jti 불일치)
    → refresh_token_jti = nil → Refresh Token도 무효화
```

### 10.2 jti 기반 Revocation 메커니즘

```
[로그인 시]
  users.jti = "abc-123"
  Access Token payload.jti = "abc-123"  → 일치 → 유효

[로그아웃 시]
  users.jti = "def-456" (새로 생성)
  Access Token payload.jti = "abc-123"  → 불일치 → 무효 (401)
```

---

## 11. Devise + Rails API 모드 호환성

### 11.1 필요한 미들웨어

Devise는 기본적으로 session/flash를 사용하지만, Rails API 모드에서는 이들이 없다.
devise-jwt를 사용하면 session 없이 동작하지만, 일부 Devise 내부 코드가 session을 참조한다.

```ruby
# config/application.rb (필요 시 추가)
config.middleware.use ActionDispatch::Cookies
config.middleware.use ActionDispatch::Session::CookieStore
```

**대안**: Devise 설정에서 `config.navigational_formats = []`로 설정하면 대부분의 session 의존성을 회피할 수 있다. 테스트 단계에서 미들웨어 추가 여부를 최종 결정한다.

### 11.2 Warden 설정

devise-jwt는 Warden의 `after_set_user` 콜백에 JWT 발급/검증 로직을 연결한다.
Rails API 모드에서 Warden은 Devise와 함께 자동 설정되므로 별도 설정 불필요.

---

## 12. 테스트 전략

### 12.1 모델 테스트 (spec/models/user_jwt_spec.rb)

```ruby
RSpec.describe User, "JWT" do
  describe "Devise modules" do
    it { is_expected.to validate_presence_of(:name) }
    it "includes :database_authenticatable" do
      expect(User.devise_modules).to include(:database_authenticatable)
    end
    it "includes :jwt_authenticatable" do
      expect(User.devise_modules).to include(:jwt_authenticatable)
    end
  end

  describe "#generate_refresh_token_jti!" do
    it "sets refresh_token_jti and returns it"
  end

  describe "#revoke_refresh_token!" do
    it "sets refresh_token_jti to nil"
  end

  describe "JTIMatcher" do
    it "jti is present after creation"
    it "jti changes on revocation"
  end
end
```

### 12.2 요청 테스트 (spec/requests/auth/sessions_spec.rb)

```ruby
RSpec.describe "Auth::Sessions", type: :request do
  let(:user) { create(:user, password: "password123") }

  describe "POST /auth/login" do
    context "올바른 자격 증명" do
      it "200과 함께 access_token, refresh_token, user 반환"
      it "응답의 access_token이 유효한 JWT"
    end

    context "잘못된 비밀번호" do
      it "401 반환"
    end

    context "존재하지 않는 이메일" do
      it "401 반환"
    end
  end

  describe "POST /auth/refresh" do
    context "유효한 refresh_token" do
      it "새 access_token 반환"
      it "반환된 access_token으로 API 접근 가능"
    end

    context "만료된 refresh_token" do
      it "401 반환"
    end

    context "폐기된 refresh_token (로그아웃 후)" do
      it "401 반환"
    end
  end

  describe "DELETE /auth/logout" do
    context "유효한 access_token으로 요청" do
      it "200 반환"
      it "기존 access_token으로 API 접근 시 401"
      it "기존 refresh_token으로 갱신 시 401"
    end
  end

  describe "인증된 API 호출" do
    context "유효한 access_token" do
      it "Authorization 헤더로 API 접근 가능"
    end

    context "만료된 access_token" do
      it "401 반환"
    end

    context "SERVER_MODE=false" do
      it "JWT 없이 기존 동작 (desktop@local) 유지"
    end
  end
end
```

### 12.3 서비스 테스트 (spec/services/jwt_service_spec.rb)

```ruby
RSpec.describe JwtService do
  describe ".encode_refresh_token / .decode_refresh_token" do
    it "라운드트립 인코딩/디코딩 성공"
    it "만료 시 JWT::ExpiredSignature 발생"
    it "type=refresh가 아니면 에러"
  end

  describe ".encode_access_token" do
    it "유효한 Access Token 생성"
    it "user.jti를 payload에 포함"
  end
end
```

### 12.4 Factory 변경

```ruby
# spec/factories/users.rb
FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    name { "Test User" }
    password { "password123" }     # 추가: Devise가 bcrypt로 해싱
  end
end
```

### 12.5 rails_helper.rb 변경

```ruby
# 기존 login_as 헬퍼에 JWT 방식 추가
config.include Module.new {
  def login_as(user)
    allow_any_instance_of(ApplicationController).to receive(:current_user).and_return(user)
    allow_any_instance_of(ApplicationController).to receive(:default_user).and_return(user)
  end

  # JWT 인증 헬퍼: 실제 토큰 발급 후 헤더에 설정
  def auth_headers_for(user)
    token = JwtService.encode_access_token(user)
    { "Authorization" => "Bearer #{token}" }
  end
}, type: :request
```

---

## 13. 구현 순서 (체크리스트)

### Phase 1: Gem 설치 및 Devise 초기 설정

- [ ] `Gemfile`에 devise, devise-jwt, bcrypt 추가 → `bundle install`
- [ ] `rails generate devise:install` 실행 (initializer 생성)
- [ ] `config/initializers/devise.rb` 커스터마이징 (API 모드 설정, JWT 설정)
- [ ] 필요 시 `config/application.rb`에 미들웨어 추가

### Phase 2: User 모델 Devise 통합

- [ ] `app/models/user.rb`에 Devise 모듈 + JTIMatcher 추가
- [ ] `set_defaults`에서 `encrypted_password` 자동 생성 제거
- [ ] 마이그레이션 생성 및 실행 (`refresh_token_jti` 추가)
- [ ] `db:migrate` 확인

### Phase 3: JwtService 구현

- [ ] `app/services/jwt_service.rb` 생성
- [ ] Refresh Token encode/decode
- [ ] Access Token 수동 발급 (refresh 용)

### Phase 4: 컨트롤러 및 라우트

- [ ] `app/controllers/auth/sessions_controller.rb` 생성
- [ ] `config/routes.rb`에 devise_for + refresh 라우트 추가
- [ ] `ApplicationController#authenticate_user!`에 `server_mode?` 분기 추가

### Phase 5: 테스트

- [ ] Factory 업데이트 (password 필드)
- [ ] rails_helper에 `auth_headers_for` 헬퍼 추가
- [ ] 모델 테스트
- [ ] 서비스 테스트
- [ ] 요청 테스트 (login, refresh, logout, 인증된 API)
- [ ] 로컬 모드 하위 호환 테스트

### Phase 6: 검증

- [ ] `SERVER_MODE=false`에서 기존 테스트 전체 통과 확인
- [ ] `SERVER_MODE=true`에서 인증 플로우 수동 테스트
- [ ] CORS `expose: ["Authorization"]` 동작 확인 (이미 설정됨)

---

## 14. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Devise + Rails API 모드 미들웨어 충돌 | session 관련 에러 | `navigational_formats = []` 설정, 필요 시 미들웨어 추가 |
| 기존 `encrypted_password` 값이 bcrypt 형식이 아님 | 기존 유저 로그인 불가 | 로컬 모드에서는 인증 미사용이므로 무관. 서버 모드 전용 유저만 새로 생성 |
| devise-jwt JTIMatcher가 모든 요청에서 DB 조회 | 성능 | 20명 규모에서 문제 없음. 필요 시 Redis 캐시 추가 (현재 불필요) |
| Refresh Token 탈취 시 30일간 유효 | 보안 | HTTPS 강제, Refresh Token은 HTTP-only 개념으로 클라이언트에서 안전 저장. 로그아웃 시 즉시 폐기 |
| `devise:install` 생성기가 불필요한 파일 생성 | 코드 오염 | 생성 후 불필요한 파일(views, mailer 등) 즉시 삭제 |

---

## 15. 이 태스크 범위 외 (후속 태스크)

| 항목 | 담당 태스크 |
|------|-----------|
| 브라우저 로그인 HTML 폼 | TSK-01-02 |
| `SERVER_MODE` 환경변수 분기 정식 구현 | TSK-01-03 |
| CORS 서버 도메인 추가 | TSK-01-03 |
| Tauri 딥링크 수신 | TSK-02-01 |
| 프론트엔드 JWT 저장/갱신 | TSK-02-03 |
| User 모델 LLM 필드 추가 | TSK-03-01 |
