# TSK-01-02: 브라우저 로그인 페이지 - 설계 문서

> **status:** design
> **updated:** 2026-04-02
> **depends:** TSK-01-01
> **branch:** dev/WP-01

---

## 1. 아키텍처 개요

### 1.1 현재 상태

- TSK-01-01 완료: Devise JWT 인증 구현됨
- `POST /auth/login` (JSON API) — 이메일+비밀번호 -> JWT 발급
- `POST /auth/refresh` — Refresh Token -> 새 Access Token
- `DELETE /auth/logout` — 토큰 무효화
- Rails API-only 모드 (`config.api_only = true`) — 뷰 렌더링 미들웨어 없음
- `Auth::SessionsController < Devise::SessionsController` — JSON 응답만 처리

### 1.2 목표 상태

Tauri 앱에서 외부 브라우저를 통한 로그인 흐름을 지원하는 서버 렌더링 HTML 페이지를 추가한다.

```
[Tauri 앱]                              [외부 브라우저]                        [Rails 서버]
    |                                         |                                    |
    |-- open(서버/auth/login?callback=...) -->|                                    |
    |                                         |-- GET /auth/login?callback=... --->|
    |                                         |<-- 200 HTML 로그인 폼 -------------|
    |                                         |                                    |
    |                                         |-- POST /auth/browser_login ------->|
    |                                         |   {email, password, callback}      |
    |                                         |                                    |
    |                                         |   [인증 성공]                       |
    |                                         |<-- 302 ddobak://callback?token=..--|
    |<-- deep-link 수신 ---------------------|                                    |
    |   토큰 저장 -> 메인 화면                  |                                    |
    |                                         |   [인증 실패]                       |
    |                                         |<-- 200 HTML (에러 메시지 표시) -----|
```

### 1.3 설계 원칙

- **별도 컨트롤러**: 브라우저 로그인은 `Auth::BrowserSessionsController`로 분리하여 기존 JSON API(`Auth::SessionsController`)에 영향 없도록 한다
- **Rails API-only 호환**: `ActionController::Base`를 상속하지 않고, `render html:` 또는 인라인 ERB로 HTML 응답하여 추가 미들웨어 불필요
- **Tailwind CSS CDN**: 별도 에셋 파이프라인 없이 CDN 스크립트 태그로 스타일링
- **CSRF 보호**: `authenticity_token`을 hidden field로 포함, 커스텀 검증 구현
- **callback URL 검증**: 허용된 스킴(`ddobak://`)만 리다이렉트 허용

---

## 2. 파일 변경 목록

### 2.1 신규 생성

| 파일 | 목적 |
|------|------|
| `app/controllers/auth/browser_sessions_controller.rb` | 브라우저 로그인 컨트롤러 |
| `spec/requests/auth/browser_sessions_spec.rb` | 브라우저 로그인 테스트 |

### 2.2 수정

| 파일 | 변경 내용 |
|------|----------|
| `config/routes.rb` | 브라우저 로그인 라우트 추가 |

---

## 3. 라우팅

### 3.1 routes.rb 변경

```ruby
# config/routes.rb
Rails.application.routes.draw do
  # ... 기존 라우트 ...

  # ── Authentication (Devise + JWT) ──
  devise_for :users, path: "auth",
    path_names: { sign_in: "login", sign_out: "logout" },
    controllers: { sessions: "auth/sessions" },
    defaults: { format: :json }

  devise_scope :user do
    post "auth/refresh", to: "auth/sessions#refresh"
  end

  # ── Browser Login (서버 렌더링 HTML) ──
  get  "auth/login",          to: "auth/browser_sessions#new"      # 폼 렌더링
  post "auth/browser_login",  to: "auth/browser_sessions#create"   # 폼 제출

  # ... 기존 API 라우트 ...
end
```

### 3.2 라우트 우선순위 고려

- `devise_for` 는 `POST /auth/login` 을 `auth/sessions#create`(JSON API)에 매핑
- `GET /auth/login` 은 Devise가 `devise_for ... defaults: { format: :json }` 로 설정하여 `GET /auth/login.json` 에만 반응
- 별도로 `get "auth/login"` 을 정의하면 format 제한 없는 GET 요청을 `browser_sessions#new`가 처리
- 만약 Devise 라우트와 충돌이 발생하면, `constraints: ->(req) { !req.xhr? && req.format.html? }` 조건을 추가하거나, 경로를 `auth/web_login` 으로 변경

**대안 (충돌 방지)**: Devise가 `GET /auth/login`을 점유할 수 있으므로, 브라우저 로그인 경로를 별도로 둔다:

```ruby
# 충돌 방지를 위한 안전한 대안
scope "auth" do
  get  "web_login",  to: "auth/browser_sessions#new",    as: :browser_login
  post "web_login",  to: "auth/browser_sessions#create",  as: :browser_login_submit
end
```

**결정**: 구현 단계에서 `rails routes` 출력을 확인하여 충돌 여부를 판단한 후 경로를 최종 확정한다. 우선 `GET /auth/login` 을 시도하고, 충돌 시 `GET /auth/web_login` 으로 폴백한다.

### 3.3 생성되는 라우트

| Method | Path | Controller#Action | 비고 |
|--------|------|-------------------|------|
| GET | `/auth/login` (또는 `/auth/web_login`) | `auth/browser_sessions#new` | HTML 로그인 폼 |
| POST | `/auth/browser_login` (또는 `/auth/web_login`) | `auth/browser_sessions#create` | 폼 제출 처리 |
| POST | `/auth/login` | `auth/sessions#create` | 기존 JSON API (변경 없음) |

---

## 4. 컨트롤러 설계

### 4.1 Auth::BrowserSessionsController

```ruby
# app/controllers/auth/browser_sessions_controller.rb
class Auth::BrowserSessionsController < ApplicationController
  # CSRF 토큰 생성/검증을 위한 모듈
  include ActionController::RequestForgeryProtection

  # JSON API 인증 건너뛰기 (이 컨트롤러는 비인증 접근 허용)
  skip_before_action :verify_authenticity_token, only: []  # CSRF는 수동 검증
  protect_from_forgery with: :exception

  ALLOWED_CALLBACK_SCHEMES = %w[ddobak].freeze

  # GET /auth/login?callback=ddobak://
  def new
    @callback = params[:callback]
    @error = params[:error]

    unless valid_callback?(@callback)
      render_error_page("잘못된 callback URL입니다.")
      return
    end

    render_login_form
  end

  # POST /auth/browser_login
  def create
    @callback = params[:callback]
    email = params[:email]
    password = params[:password]

    unless valid_callback?(@callback)
      render_error_page("잘못된 callback URL입니다.")
      return
    end

    user = User.find_by(email: email)

    if user&.valid_password?(password)
      # JWT 토큰 발급
      access_token = JwtService.encode_access_token(user)
      refresh_jti = user.generate_refresh_token_jti!
      refresh_token = JwtService.encode_refresh_token(user, refresh_jti)

      # 딥링크 리다이렉트
      redirect_url = build_callback_url(
        @callback,
        access_token: access_token,
        refresh_token: refresh_token
      )
      redirect_to redirect_url, allow_other_host: true
    else
      @error = "이메일 또는 비밀번호가 올바르지 않습니다."
      render_login_form(status: :unauthorized)
    end
  end

  private

  def valid_callback?(callback)
    return false if callback.blank?

    uri = URI.parse(callback)
    ALLOWED_CALLBACK_SCHEMES.include?(uri.scheme)
  rescue URI::InvalidURIError
    false
  end

  def build_callback_url(callback, access_token:, refresh_token:)
    # callback = "ddobak://" 또는 "ddobak://callback"
    uri = URI.parse(callback)
    # ddobak://callback?access_token=xxx&refresh_token=yyy
    callback_path = uri.path.presence || "callback"
    query = URI.encode_www_form(
      access_token: access_token,
      refresh_token: refresh_token
    )
    "#{uri.scheme}://#{callback_path}?#{query}"
  end

  def render_login_form(status: :ok)
    html = build_login_html(
      callback: @callback,
      error: @error,
      csrf_token: form_authenticity_token
    )
    render html: html.html_safe, status: status
  end

  def render_error_page(message)
    html = build_error_html(message)
    render html: html.html_safe, status: :bad_request
  end

  def build_login_html(callback:, error:, csrf_token:)
    # 인라인 HTML 템플릿 (ERB 없이 문자열 빌드)
    # 아래 섹션 5에서 상세 정의
    LoginFormTemplate.render(
      callback: callback,
      error: error,
      csrf_token: csrf_token,
      action_url: "/auth/browser_login"
    )
  end

  def build_error_html(message)
    LoginFormTemplate.render_error(message: message)
  end
end
```

### 4.2 CSRF 보호 상세

Rails API-only 앱에서는 `ActionController::RequestForgeryProtection`이 기본 포함되지 않는다.
브라우저 폼 제출에는 CSRF 보호가 필요하므로 이 컨트롤러에서만 수동으로 포함한다.

```ruby
# CSRF 처리 흐름:
# 1. GET /auth/login → form_authenticity_token 생성 → hidden field로 포함
# 2. POST /auth/browser_login → authenticity_token 파라미터 자동 검증
# 3. 토큰 불일치 시 ActionController::InvalidAuthenticityToken 발생
```

**세션 미들웨어 필요성**: `form_authenticity_token`은 세션에 CSRF 토큰을 저장한다. Rails API-only 모드에서는 세션 미들웨어가 없으므로 추가가 필요하다.

**대안 1 - 세션 미들웨어 추가** (이 컨트롤러 전용):

```ruby
class Auth::BrowserSessionsController < ApplicationController
  include ActionController::RequestForgeryProtection
  include ActionController::Cookies

  # 쿠키 기반 세션 활성화 (이 컨트롤러에서만)
  before_action :enable_session

  private

  def enable_session
    # API-only 앱에서 세션을 쿠키로 활성화
    request.session_options[:skip] = false
  end
end
```

**대안 2 - HMAC 기반 커스텀 CSRF (세션 불필요)**:

```ruby
# 세션 없이 CSRF 방지:
# 1. GET에서 timestamp + HMAC(secret, timestamp) 조합의 토큰 생성
# 2. POST에서 토큰의 timestamp가 유효 기간 내인지 + HMAC 일치 확인
# 3. 세션 저장소 불필요

module CsrfTokenHelper
  SECRET = -> { Rails.application.secret_key_base }
  TOKEN_VALIDITY = 1.hour

  def generate_csrf_token
    timestamp = Time.current.to_i
    signature = OpenSSL::HMAC.hexdigest("SHA256", SECRET.call, timestamp.to_s)
    "#{timestamp}:#{signature}"
  end

  def valid_csrf_token?(token)
    return false if token.blank?

    parts = token.split(":")
    return false unless parts.length == 2

    timestamp, signature = parts
    return false if (Time.current.to_i - timestamp.to_i) > TOKEN_VALIDITY

    expected = OpenSSL::HMAC.hexdigest("SHA256", SECRET.call, timestamp)
    ActiveSupport::SecurityUtils.secure_compare(signature, expected)
  end
end
```

**결정**: 대안 2 (HMAC 기반 커스텀 CSRF)를 채택한다.
- Rails API-only 앱에 세션 미들웨어를 추가하면 다른 컨트롤러에 영향을 줄 수 있다
- 브라우저 로그인 페이지 하나를 위해 세션 스택 전체를 도입하는 것은 과도하다
- HMAC 방식은 stateless하며, 이 컨트롤러에만 적용된다

---

## 5. HTML 템플릿

### 5.1 설계 방향

- ERB 뷰를 사용하지 않고, Ruby 문자열로 HTML을 빌드한다 (API-only 앱에 뷰 레이어 추가 회피)
- 별도 헬퍼 클래스 `LoginFormTemplate`으로 분리하여 컨트롤러를 깨끗하게 유지
- Tailwind CSS Play CDN (`<script src="https://cdn.tailwindcss.com">`)으로 스타일링
- 반응형, 모바일 대응

### 5.2 LoginFormTemplate

```ruby
# app/services/login_form_template.rb
class LoginFormTemplate
  class << self
    def render(callback:, error:, csrf_token:, action_url:)
      <<~HTML
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>또박또박 - 로그인</title>
          <script src="https://cdn.tailwindcss.com"></script>
          <script>
            tailwind.config = {
              theme: {
                extend: {
                  colors: {
                    primary: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' }
                  }
                }
              }
            }
          </script>
        </head>
        <body class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div class="w-full max-w-md">
            <!-- 로고 / 제목 -->
            <div class="text-center mb-8">
              <h1 class="text-3xl font-bold text-gray-900">또박또박</h1>
              <p class="mt-2 text-gray-600">회의록 자동 작성 서비스</p>
            </div>

            <!-- 로그인 카드 -->
            <div class="bg-white rounded-2xl shadow-lg p-8">
              <h2 class="text-xl font-semibold text-gray-800 mb-6">로그인</h2>

              #{error_html(error)}

              <form action="#{action_url}" method="post" class="space-y-5">
                <input type="hidden" name="authenticity_token" value="#{escape(csrf_token)}">
                <input type="hidden" name="callback" value="#{escape(callback)}">

                <!-- 이메일 -->
                <div>
                  <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
                    이메일
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    autocomplete="email"
                    autofocus
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           transition-colors text-gray-900 placeholder-gray-400"
                    placeholder="name@company.com"
                  >
                </div>

                <!-- 비밀번호 -->
                <div>
                  <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
                    비밀번호
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    required
                    autocomplete="current-password"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-primary-500 focus:border-primary-500
                           transition-colors text-gray-900 placeholder-gray-400"
                    placeholder="비밀번호 입력"
                  >
                </div>

                <!-- 제출 버튼 -->
                <button
                  type="submit"
                  class="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700
                         text-white font-medium rounded-lg transition-colors
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                >
                  로그인
                </button>
              </form>
            </div>

            <!-- 하단 안내 -->
            <p class="mt-6 text-center text-sm text-gray-500">
              로그인 후 또박또박 앱으로 자동 이동합니다.
            </p>
          </div>
        </body>
        </html>
      HTML
    end

    def render_error(message:)
      <<~HTML
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>또박또박 - 오류</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div class="w-full max-w-md text-center">
            <div class="bg-white rounded-2xl shadow-lg p-8">
              <div class="text-red-500 text-5xl mb-4">&#9888;</div>
              <h1 class="text-xl font-semibold text-gray-800 mb-2">오류</h1>
              <p class="text-gray-600">#{escape(message)}</p>
            </div>
          </div>
        </body>
        </html>
      HTML
    end

    private

    def error_html(error)
      return "" if error.blank?

      <<~HTML
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm text-red-700">#{escape(error)}</p>
        </div>
      HTML
    end

    def escape(text)
      ERB::Util.html_escape(text.to_s)
    end
  end
end
```

### 5.3 UI 디자인 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 스타일링 | Tailwind CSS Play CDN | WBS 요구사항. 별도 빌드 불필요 |
| 레이아웃 | 중앙 정렬 카드 | 간결하고 모바일 대응 |
| 색상 | blue-600 계열 (primary) | 중립적이고 신뢰감 있는 컬러 |
| 에러 표시 | 폼 상단 빨간 배너 | 사용자 눈에 잘 띄는 위치 |
| 폰트 | 시스템 기본 | 추가 폰트 로딩 불필요 |
| 언어 | 한국어 | 팀 내부 서비스 |

---

## 6. 인증 흐름 상세

### 6.1 성공 흐름

```
[1] Tauri 앱: open("https://서버/auth/login?callback=ddobak://")

[2] 브라우저: GET /auth/login?callback=ddobak://
    → BrowserSessionsController#new
    → callback 검증 (ddobak:// 스킴 허용)
    → CSRF 토큰 생성
    → HTML 로그인 폼 렌더링

[3] 사용자: 이메일, 비밀번호 입력 후 제출

[4] 브라우저: POST /auth/browser_login
    → CSRF 토큰 검증
    → callback 검증 (재검증)
    → User.find_by(email:) + valid_password?(password)
    → [성공] JwtService.encode_access_token(user)
    → user.generate_refresh_token_jti!
    → JwtService.encode_refresh_token(user, jti)
    → 302 redirect to: ddobak://callback?access_token=xxx&refresh_token=yyy

[5] OS가 ddobak:// 딥링크를 Tauri 앱으로 전달
    → Tauri deep-link 플러그인이 URL 파싱
    → access_token, refresh_token을 localStorage에 저장
    → 메인 화면으로 이동
```

### 6.2 실패 흐름

```
[3-b] 사용자: 잘못된 비밀번호 입력

[4-b] 브라우저: POST /auth/browser_login
    → User.find_by(email:) → nil 또는 valid_password? → false
    → 에러 메시지와 함께 로그인 폼 재렌더링 (status: 401)
    → 사용자가 다시 입력 가능
```

### 6.3 callback 검증 실패 흐름

```
[2-c] 브라우저: GET /auth/login?callback=https://evil.com
    → valid_callback? → false (https 스킴 불허)
    → 에러 페이지 렌더링 (status: 400)
```

---

## 7. JWT 토큰 발급

### 7.1 기존 API vs 브라우저 로그인 토큰 차이

| 항목 | POST /auth/login (JSON API) | POST /auth/browser_login (HTML) |
|------|------|------|
| 인증 방식 | Warden + Devise 자동 | `User.find_by + valid_password?` 수동 |
| Access Token | `request.env["warden-jwt_auth.token"]` | `JwtService.encode_access_token(user)` |
| Refresh Token | `JwtService.encode_refresh_token` | `JwtService.encode_refresh_token` |
| 응답 형식 | JSON body | 302 redirect (URL 파라미터) |

**동일한 토큰 구조**: 두 방식 모두 같은 `JwtService`를 사용하므로 토큰 형식과 검증 방식이 동일하다.

### 7.2 토큰 전달 방식

```
ddobak://callback?access_token=eyJ...&refresh_token=eyJ...
```

- URL 파라미터로 전달 (딥링크 URL의 query string)
- HTTPS 통신이므로 네트워크 도청 위험 낮음
- 딥링크 수신 후 Tauri 앱에서 URL에서 토큰을 추출하여 localStorage에 저장

---

## 8. 보안 고려사항

### 8.1 CSRF 보호

| 위협 | 대응 |
|------|------|
| 외부 사이트에서 POST /auth/browser_login으로 폼 전송 | HMAC 기반 CSRF 토큰으로 차단 |
| CSRF 토큰 재사용 | 1시간 유효기간 설정 |

### 8.2 callback URL 검증

| 위협 | 대응 |
|------|------|
| Open Redirect (callback=https://evil.com) | `ALLOWED_CALLBACK_SCHEMES`로 `ddobak://`만 허용 |
| JavaScript injection (callback=javascript:alert(1)) | URI 파싱 후 스킴 검증 |
| 조작된 callback 경로 | URI.parse로 정규화, 스킴만 검증 |

```ruby
ALLOWED_CALLBACK_SCHEMES = %w[ddobak].freeze

def valid_callback?(callback)
  return false if callback.blank?
  uri = URI.parse(callback)
  ALLOWED_CALLBACK_SCHEMES.include?(uri.scheme)
rescue URI::InvalidURIError
  false
end
```

### 8.3 비밀번호 브루트포스

| 위협 | 대응 |
|------|------|
| 자동화된 로그인 시도 | Phase 1에서는 팀 내부용이므로 별도 제한 없음 |
| 향후 대응 | `devise-lockable` 모듈 추가 시 계정 잠금 가능 |

### 8.4 토큰 노출

| 위협 | 대응 |
|------|------|
| 리다이렉트 URL이 브라우저 히스토리에 남음 | `ddobak://` 스킴은 브라우저 히스토리에 남지 않음 (외부 프로토콜) |
| Referer 헤더로 토큰 유출 | 리다이렉트 후 외부 사이트 접근 없으므로 Referer 유출 없음 |
| 네트워크 스니핑 | HTTPS (Cloudflare Tunnel) 사용으로 암호화 |

### 8.5 HTML Injection / XSS

| 위협 | 대응 |
|------|------|
| callback 파라미터에 스크립트 삽입 | `ERB::Util.html_escape`로 모든 동적 값 이스케이프 |
| 에러 메시지에 스크립트 삽입 | 고정 문자열만 사용 (사용자 입력 에러 메시지 없음) |

---

## 9. 테스트 전략

### 9.1 요청 테스트 (spec/requests/auth/browser_sessions_spec.rb)

```ruby
RSpec.describe "Auth::BrowserSessions", type: :request do
  let(:password) { "password123" }
  let(:user) { create(:user, password: password) }

  describe "GET /auth/login" do
    context "유효한 callback" do
      it "200과 함께 로그인 폼 HTML 반환" do
        get "/auth/login", params: { callback: "ddobak://" }

        expect(response).to have_http_status(:ok)
        expect(response.content_type).to include("text/html")
        expect(response.body).to include("이메일")
        expect(response.body).to include("비밀번호")
        expect(response.body).to include("authenticity_token")
      end

      it "callback 값을 hidden field에 포함" do
        get "/auth/login", params: { callback: "ddobak://callback" }

        expect(response.body).to include("ddobak://callback")
      end
    end

    context "잘못된 callback 스킴" do
      it "400 에러 페이지 반환" do
        get "/auth/login", params: { callback: "https://evil.com" }

        expect(response).to have_http_status(:bad_request)
      end
    end

    context "callback 없음" do
      it "400 에러 페이지 반환" do
        get "/auth/login"

        expect(response).to have_http_status(:bad_request)
      end
    end
  end

  describe "POST /auth/browser_login" do
    let(:csrf_token) { "valid_token" }  # 테스트에서는 CSRF 검증 모킹

    context "올바른 자격 증명" do
      it "ddobak:// 딥링크로 리다이렉트" do
        post "/auth/browser_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:redirect)
        expect(response.location).to start_with("ddobak://callback?")
        expect(response.location).to include("access_token=")
        expect(response.location).to include("refresh_token=")
      end

      it "유효한 JWT 토큰을 URL에 포함" do
        post "/auth/browser_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        uri = URI.parse(response.location)
        params = URI.decode_www_form(uri.query).to_h

        secret = Devise::JWT.config.secret
        decoded = JWT.decode(params["access_token"], secret, true, algorithm: "HS256")
        expect(decoded.first["sub"]).to eq(user.id)
      end

      it "refresh_token_jti를 user에 저장" do
        expect {
          post "/auth/browser_login", params: {
            email: user.email,
            password: password,
            callback: "ddobak://",
            authenticity_token: csrf_token
          }
        }.to change { user.reload.refresh_token_jti }.from(nil)
      end
    end

    context "잘못된 비밀번호" do
      it "401과 에러 메시지를 포함한 로그인 폼 반환" do
        post "/auth/browser_login", params: {
          email: user.email,
          password: "wrong",
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:unauthorized)
        expect(response.body).to include("이메일 또는 비밀번호가 올바르지 않습니다")
      end
    end

    context "존재하지 않는 이메일" do
      it "401 반환" do
        post "/auth/browser_login", params: {
          email: "nobody@example.com",
          password: "whatever",
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "잘못된 callback 스킴" do
      it "400 에러 페이지 반환" do
        post "/auth/browser_login", params: {
          email: user.email,
          password: password,
          callback: "https://evil.com",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:bad_request)
      end
    end
  end
end
```

### 9.2 서비스 테스트 (LoginFormTemplate)

```ruby
RSpec.describe LoginFormTemplate do
  describe ".render" do
    it "HTML 문서를 반환" do
      html = described_class.render(
        callback: "ddobak://",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/browser_login"
      )

      expect(html).to include("<!DOCTYPE html>")
      expect(html).to include("또박또박")
      expect(html).to include("test-token")
    end

    it "에러 메시지를 포함" do
      html = described_class.render(
        callback: "ddobak://",
        error: "잘못된 비밀번호",
        csrf_token: "test-token",
        action_url: "/auth/browser_login"
      )

      expect(html).to include("잘못된 비밀번호")
    end

    it "XSS 공격을 이스케이프" do
      html = described_class.render(
        callback: "<script>alert(1)</script>",
        error: nil,
        csrf_token: "test-token",
        action_url: "/auth/browser_login"
      )

      expect(html).not_to include("<script>alert(1)</script>")
      expect(html).to include("&lt;script&gt;")
    end
  end
end
```

---

## 10. 구현 순서 (체크리스트)

### Phase 1: HTML 템플릿

- [ ] `app/services/login_form_template.rb` 생성
- [ ] 로그인 폼 HTML 빌드 메서드
- [ ] 에러 페이지 HTML 빌드 메서드
- [ ] XSS 이스케이프 확인

### Phase 2: CSRF 토큰 모듈

- [ ] HMAC 기반 CSRF 토큰 생성/검증 모듈 구현
- [ ] `Auth::BrowserSessionsController`에 적용

### Phase 3: 컨트롤러

- [ ] `app/controllers/auth/browser_sessions_controller.rb` 생성
- [ ] `GET /auth/login` → `new` 액션 (폼 렌더링)
- [ ] `POST /auth/browser_login` → `create` 액션 (인증 + 리다이렉트)
- [ ] callback URL 검증 로직
- [ ] JWT 토큰 발급 및 딥링크 URL 빌드

### Phase 4: 라우팅

- [ ] `config/routes.rb`에 브라우저 로그인 라우트 추가
- [ ] `rails routes`로 기존 Devise 라우트와 충돌 여부 확인
- [ ] 충돌 시 경로 조정 (`/auth/web_login`)

### Phase 5: 테스트

- [ ] `spec/requests/auth/browser_sessions_spec.rb` 작성
- [ ] `spec/services/login_form_template_spec.rb` 작성
- [ ] 로그인 성공 → 딥링크 리다이렉트 검증
- [ ] 로그인 실패 → 에러 메시지 표시 검증
- [ ] callback 검증 (허용/거부 스킴)
- [ ] CSRF 토큰 검증
- [ ] XSS 이스케이프 검증

### Phase 6: 수동 검증

- [ ] 브라우저에서 `http://localhost:13323/auth/login?callback=ddobak://` 접근
- [ ] 로그인 폼 표시 확인
- [ ] 올바른 자격 증명으로 제출 → 딥링크 리다이렉트 확인
- [ ] 잘못된 자격 증명 → 에러 메시지 확인
- [ ] callback 없이 접근 → 에러 페이지 확인

---

## 11. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Devise 라우트와 GET /auth/login 충돌 | 로그인 폼이 표시되지 않음 | `rails routes` 확인, 필요 시 `/auth/web_login`으로 경로 변경 |
| Rails API-only에서 CSRF 미들웨어 부재 | 세션 기반 CSRF 토큰 생성 불가 | HMAC 기반 stateless CSRF 토큰으로 대체 |
| Tailwind CDN 로딩 실패 (오프라인) | 스타일 없는 폼 표시 | 팀 서버용이므로 인터넷 연결 전제. 최소 인라인 CSS 폴백 고려 |
| 딥링크 URL 길이 제한 | 토큰이 길어 URL 초과 가능 | JWT access + refresh 합계 약 500~600자. URL 길이 제한(2048자) 이내 |
| macOS에서 `ddobak://` 딥링크 미등록 상태 | 리다이렉트 후 앱 미실행 | TSK-02-01에서 Tauri 딥링크 등록. 이 태스크에서는 리다이렉트만 담당 |

---

## 12. 이 태스크 범위 외 (후속 태스크)

| 항목 | 담당 태스크 |
|------|-----------|
| Tauri 딥링크 수신 및 토큰 저장 | TSK-02-01 |
| 프론트엔드 JWT 저장/갱신/로그아웃 | TSK-02-03 |
| SERVER_MODE 환경변수 분기 정식 구현 | TSK-01-03 |
| 회원가입 / 계정 관리 페이지 | 별도 태스크 (필요 시) |
| 비밀번호 재설정 | 별도 태스크 (필요 시) |
