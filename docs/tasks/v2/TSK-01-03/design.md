# TSK-01-03: 서버/로컬 모드 분기 - 설계 문서

> **status:** design
> **updated:** 2026-04-02
> **depends:** TSK-01-01
> **branch:** dev/WP-01

---

## 1. 현재 상태 분석

### 1.1 ApplicationController (TSK-01-01에서 이미 변경됨)

TSK-01-01에서 `server_mode?` 분기가 `authenticate_user!`와 `current_user`에 이미 적용되어 있다.

```ruby
class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include DefaultUserLookup      # ← 아직 include 중이나, 실제로는 미사용

  def authenticate_user!
    if server_mode?
      warden.authenticate!(scope: :user)
      @current_user = warden.user(:user)
    else
      @current_user = default_user     # ← DefaultUserLookup에서 제공
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
end
```

**문제점:**
1. `DefaultUserLookup` concern이 여전히 별도 파일로 존재하지만, `ApplicationController`에서 `default_user`를 직접 호출하는 로직이 `authenticate_user!`/`current_user` 안에 있어 concern의 역할이 모호
2. `ApplicationCable::Connection`에서도 `DefaultUserLookup`을 include하고 있으며, 서버 모드 분기가 적용되어 있지 않음
3. CORS 설정에 서버 도메인 오리진이 없음

### 1.2 DefaultUserLookup concern

```ruby
module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end
end
```

- `ApplicationController`와 `ApplicationCable::Connection` 두 곳에서 include
- 서버 모드에서는 이 메서드가 호출되면 안 됨 (desktop@local 유저가 불필요하게 생성될 수 있음)

### 1.3 ApplicationCable::Connection

```ruby
module ApplicationCable
  class Connection < ActionCable::Connection::Base
    include DefaultUserLookup

    identified_by :current_user

    def connect
      self.current_user = default_user    # ← 서버 모드에서도 무조건 desktop@local
    end
  end
end
```

서버 모드에서 WebSocket 연결 시에도 JWT 인증이 필요하나, 현재는 무조건 `desktop@local`을 사용한다.

### 1.4 CORS 설정

```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(
      "http://localhost:13325",
      "tauri://localhost",
      "https://tauri.localhost"
    )
    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
```

- Tauri 로컬 개발용 오리진만 허용
- 서버 모드에서 Cloudflare Tunnel 도메인 (예: `https://api.도메인.com`)이 CORS 허용 목록에 없음

### 1.5 before_action :authenticate_user! 사용처

모든 API v1 컨트롤러(13개)가 `before_action :authenticate_user!`를 사용:

- `ActionItemsController`, `SpeakersController`, `MeetingsAudioController`
- `TagsController`, `MeetingsController`, `TeamsController`
- `SettingsController`, `BlocksController`, `PromptTemplatesController`
- `MeetingAttachmentsController`, `TranscriptsController`, `FoldersController`
- `MeetingActionItemsController`

`HealthController`는 `authenticate_user!`를 사용하지 **않음** (인증 없이 접근 가능).

---

## 2. 변경 사항 상세 설계

### 2.1 DefaultUserLookup concern 수정

**방안**: concern을 유지하되, 서버 모드 분기를 concern 내부에 적용한다.
이렇게 하면 `ApplicationController`와 `ApplicationCable::Connection` 모두에서 일관된 동작을 보장한다.

```ruby
# app/controllers/concerns/default_user_lookup.rb
module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def default_user
    raise_server_mode_error! if server_mode?

    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end

  def server_mode?
    ENV["SERVER_MODE"] == "true"
  end

  def raise_server_mode_error!
    raise "default_user should not be called in server mode. Use JWT authentication instead."
  end
end
```

**이유:**
- `server_mode?`에서 `default_user`가 호출되면 명시적 에러 → 실수 방지
- 개발 중 잘못된 호출 경로를 조기 발견
- concern은 `server_mode?` 헬퍼도 제공하여 일관성 확보

### 2.2 ApplicationController 변경

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include DefaultUserLookup

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  private

  def authenticate_user!
    if server_mode?
      warden.authenticate!(scope: :user)
      @current_user = warden.user(:user)
    else
      @current_user = local_default_user
    end
    true
  end

  def current_user
    @current_user ||= if server_mode?
      warden.user(:user)
    else
      local_default_user
    end
  end

  # 로컬 모드 전용: desktop@local 유저 반환
  # server_mode? 체크를 우회하여 직접 호출
  def local_default_user
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

**변경 포인트:**
- `default_user` 대신 `local_default_user`를 직접 호출 (concern의 `default_user`는 서버 모드 안전 장치)
- `server_mode?`는 concern에서 제공 (DRY)
- 기존 동작 100% 유지: 로컬 모드에서는 `local_default_user` → `desktop@local` 자동 생성

### 2.3 ApplicationCable::Connection 서버 모드 분기

```ruby
# app/channels/application_cable/connection.rb
module ApplicationCable
  class Connection < ActionCable::Connection::Base
    include DefaultUserLookup

    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      if server_mode?
        authenticate_websocket_user
      else
        local_default_user
      end
    end

    def authenticate_websocket_user
      token = extract_token
      return reject_unauthorized_connection unless token

      payload = decode_jwt(token)
      return reject_unauthorized_connection unless payload

      user = User.find_by(id: payload["sub"], jti: payload["jti"])
      return reject_unauthorized_connection unless user

      user
    rescue JWT::DecodeError, JWT::ExpiredSignature
      reject_unauthorized_connection
    end

    def extract_token
      # WebSocket 연결 시 query parameter로 토큰 전달
      # ws://server/cable?token=xxx
      request.params["token"]
    end

    def decode_jwt(token)
      secret = Devise::JWT.config.secret
      decoded = JWT.decode(token, secret, true, algorithm: "HS256")
      decoded.first
    rescue JWT::DecodeError, JWT::ExpiredSignature
      nil
    end

    def local_default_user
      User.find_or_create_by!(email: "desktop@local") do |u|
        u.name = "사용자"
      end
    end
  end
end
```

**설계 결정:**
- WebSocket은 HTTP 헤더에 Authorization을 설정할 수 없으므로 **query parameter** 방식 사용
- `ws://server/cable?token=<access_token>` 형태
- JWT 디코딩 + jti 검증으로 유효성 확인
- 로컬 모드: 기존 `desktop@local` 유지

### 2.4 CORS 설정 변경

```ruby
# config/initializers/cors.rb
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    # 기본 오리진 (Tauri 로컬 개발)
    allowed_origins = [
      "http://localhost:13325",
      "tauri://localhost",
      "https://tauri.localhost"
    ]

    # 서버 모드: CORS_ORIGIN 환경변수로 추가 오리진 허용
    if ENV["CORS_ORIGIN"].present?
      allowed_origins += ENV["CORS_ORIGIN"].split(",").map(&:strip)
    end

    origins(*allowed_origins)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      expose: ["Authorization"]
  end
end
```

**환경변수 사용 예시:**
```bash
# 단일 도메인
CORS_ORIGIN=https://api.ddobak.example.com

# 복수 도메인
CORS_ORIGIN=https://api.ddobak.example.com,https://staging.ddobak.example.com
```

**설계 결정:**
- 기존 Tauri 로컬 오리진은 항상 허용 (하위 호환)
- `CORS_ORIGIN` 환경변수가 없으면 기존과 동일하게 동작
- 쉼표 구분으로 복수 도메인 지원

---

## 3. 파일 변경 목록

### 3.1 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `app/controllers/concerns/default_user_lookup.rb` | 서버 모드 안전 장치 추가, `server_mode?` 헬퍼 제공 |
| `app/controllers/application_controller.rb` | `local_default_user` 메서드 도입, concern의 `server_mode?` 활용 |
| `app/channels/application_cable/connection.rb` | 서버 모드 JWT 인증 분기 추가 |
| `config/initializers/cors.rb` | `CORS_ORIGIN` 환경변수 기반 동적 오리진 추가 |

### 3.2 신규 파일

| 파일 | 목적 |
|------|------|
| `spec/requests/server_local_mode_spec.rb` | 서버/로컬 모드 분기 통합 테스트 |
| `spec/channels/connection_spec.rb` | ActionCable 연결 인증 테스트 |

### 3.3 변경 없는 파일

- `config/routes.rb` — 변경 없음
- `app/models/user.rb` — 변경 없음
- `app/controllers/auth/sessions_controller.rb` — 변경 없음
- API v1 컨트롤러들 — 변경 없음 (`authenticate_user!`는 `ApplicationController`에서 처리)

---

## 4. 테스트 전략

### 4.1 서버/로컬 모드 분기 통합 테스트

```ruby
# spec/requests/server_local_mode_spec.rb
RSpec.describe "Server/Local mode branching", type: :request do
  let(:password) { "password123" }
  let(:user) { create(:user, password: password) }

  describe "LOCAL mode (SERVER_MODE=false, default)" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = nil
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "allows API access without JWT (uses desktop@local)" do
      get "/api/v1/meetings", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "creates desktop@local user automatically" do
      get "/api/v1/health", as: :json
      expect(User.find_by(email: "desktop@local")).to be_present
    end

    it "uses desktop@local as current_user for all requests" do
      get "/api/v1/meetings", as: :json
      # 응답이 desktop@local 유저의 데이터만 반환하는지 확인
      expect(response).to have_http_status(:ok)
    end
  end

  describe "SERVER mode (SERVER_MODE=true)" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = "true"
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "rejects API requests without JWT (401)" do
      get "/api/v1/meetings", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "allows API requests with valid JWT" do
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      token = response.parsed_body["access_token"]

      get "/api/v1/meetings", headers: { "Authorization" => "Bearer #{token}" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 401 with expired JWT" do
      expired_token = travel_to(25.hours.ago) do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        response.parsed_body["access_token"]
      end

      get "/api/v1/meetings", headers: { "Authorization" => "Bearer #{expired_token}" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "health endpoint is accessible without JWT" do
      get "/api/v1/health", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "does not create desktop@local user" do
      get "/api/v1/meetings", as: :json  # 401이 나와도 desktop@local 생성 안 됨
      expect(User.find_by(email: "desktop@local")).to be_nil
    end
  end
end
```

### 4.2 ActionCable 연결 테스트

```ruby
# spec/channels/connection_spec.rb
RSpec.describe ApplicationCable::Connection, type: :channel do
  let(:user) { create(:user, password: "password123") }

  context "LOCAL mode" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = nil
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "connects without token (uses desktop@local)" do
      connect
      expect(connection.current_user.email).to eq("desktop@local")
    end
  end

  context "SERVER mode" do
    around do |example|
      original = ENV["SERVER_MODE"]
      ENV["SERVER_MODE"] = "true"
      example.run
    ensure
      ENV["SERVER_MODE"] = original
    end

    it "connects with valid JWT token" do
      token = JwtService.encode_access_token(user)
      connect params: { token: token }
      expect(connection.current_user).to eq(user)
    end

    it "rejects connection without token" do
      expect { connect }.to have_rejected_connection
    end

    it "rejects connection with invalid token" do
      expect { connect params: { token: "invalid" } }.to have_rejected_connection
    end

    it "rejects connection with expired token" do
      expired_token = travel_to(25.hours.ago) do
        JwtService.encode_access_token(user)
      end
      expect { connect params: { token: expired_token } }.to have_rejected_connection
    end
  end
end
```

### 4.3 CORS 테스트

```ruby
# spec/requests/cors_spec.rb (기존 테스트에 추가)
RSpec.describe "CORS configuration", type: :request do
  it "allows requests from Tauri localhost" do
    get "/api/v1/health", headers: { "Origin" => "https://tauri.localhost" }
    expect(response.headers["Access-Control-Allow-Origin"]).to eq("https://tauri.localhost")
  end

  context "with CORS_ORIGIN env var" do
    around do |example|
      original = ENV["CORS_ORIGIN"]
      ENV["CORS_ORIGIN"] = "https://api.ddobak.example.com"
      example.run
    ensure
      ENV["CORS_ORIGIN"] = original
    end

    it "allows requests from configured origin" do
      # CORS 미들웨어는 boot 시 설정되므로,
      # 이 테스트는 initializer 재로드가 필요할 수 있음.
      # 실제 테스트에서는 integration test로 검증.
      pending "CORS initializer는 boot 시 1회만 실행됨 — 수동/통합 테스트로 검증"
    end
  end
end
```

**참고**: CORS initializer는 Rails 부팅 시 1회 실행되므로, 환경변수 변경 후 테스트하려면 별도 프로세스가 필요하다. 이 부분은 수동 통합 테스트로 검증한다.

### 4.4 DefaultUserLookup 안전 장치 테스트

```ruby
# spec/controllers/concerns/default_user_lookup_spec.rb
RSpec.describe DefaultUserLookup do
  let(:controller_class) do
    Class.new(ActionController::API) do
      include DefaultUserLookup
      public :default_user, :server_mode?
    end
  end
  let(:controller) { controller_class.new }

  context "LOCAL mode" do
    before { allow(ENV).to receive(:[]).with("SERVER_MODE").and_return(nil) }

    it "returns desktop@local user" do
      user = controller.default_user
      expect(user.email).to eq("desktop@local")
    end
  end

  context "SERVER mode" do
    before { allow(ENV).to receive(:[]).with("SERVER_MODE").and_return("true") }

    it "raises error when default_user is called" do
      expect { controller.default_user }.to raise_error(RuntimeError, /server mode/)
    end
  end
end
```

---

## 5. 구현 순서 (체크리스트)

### Phase 1: DefaultUserLookup concern 수정

- [ ] `default_user`에 서버 모드 안전 장치 추가
- [ ] `server_mode?` 헬퍼를 concern으로 이동
- [ ] concern 테스트 작성 및 통과

### Phase 2: ApplicationController 정리

- [ ] `local_default_user` 메서드 도입
- [ ] `authenticate_user!`에서 `local_default_user` 사용
- [ ] `current_user`에서 `local_default_user` 사용
- [ ] `server_mode?` 중복 제거 (concern에서 제공)
- [ ] 기존 테스트 전체 통과 확인

### Phase 3: ApplicationCable::Connection 수정

- [ ] `find_verified_user` 메서드 추가
- [ ] 서버 모드: JWT query parameter 인증
- [ ] 로컬 모드: `local_default_user` 사용
- [ ] 채널 연결 테스트 작성 및 통과

### Phase 4: CORS 설정 변경

- [ ] `CORS_ORIGIN` 환경변수 파싱 로직 추가
- [ ] 기존 Tauri 오리진 유지 확인
- [ ] 수동 테스트 (환경변수 설정 후 서버 기동)

### Phase 5: 통합 테스트

- [ ] 서버/로컬 모드 분기 통합 테스트 작성
- [ ] `SERVER_MODE=false` (기본): 기존 동작 유지 확인
- [ ] `SERVER_MODE=true`: JWT 없이 401 확인
- [ ] `SERVER_MODE=true`: JWT로 API 접근 확인
- [ ] Health 엔드포인트: 모드 무관 접근 가능 확인
- [ ] 서버 모드에서 `desktop@local` 유저 미생성 확인

---

## 6. 환경변수 정리

| 변수 | 값 | 기본값 | 설명 |
|------|-----|--------|------|
| `SERVER_MODE` | `"true"` / 미설정 | 미설정 (로컬 모드) | 서버/로컬 모드 분기 |
| `CORS_ORIGIN` | URL (쉼표 구분 가능) | 미설정 | 서버 모드 시 추가 CORS 오리진 |

---

## 7. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| CORS initializer가 boot 시 1회만 실행됨 | 환경변수 변경 시 서버 재시작 필요 | 운영 가이드에 명시, systemd 재시작 절차 문서화 |
| WebSocket JWT가 query parameter로 노출 | URL 로그에 토큰 노출 가능 | HTTPS(Cloudflare Tunnel) 강제, 서버 로그에서 query parameter 마스킹 |
| `default_user` 안전 장치로 인한 기존 코드 영향 | 서버 모드에서 `default_user` 직접 호출 시 에러 | `local_default_user`로 명시적 분기, 테스트로 검증 |
| ActionCable 토큰 만료 시 재연결 필요 | 장시간 회의 중 WebSocket 끊김 | 프론트엔드에서 토큰 갱신 후 재연결 로직 (TSK-02-03 범위) |

---

## 8. 이 태스크 범위 외 (후속 태스크)

| 항목 | 담당 태스크 |
|------|-----------|
| 프론트엔드 WebSocket 토큰 전달 | TSK-02-03 |
| 프론트엔드 API 클라이언트 JWT 헤더 | TSK-02-03 |
| Tauri 딥링크 수신 | TSK-02-01 |
| Cloudflare Tunnel 실제 도메인 설정 | TSK-10-04 |
| 사용자별 LLM 설정 | TSK-03-01 |
