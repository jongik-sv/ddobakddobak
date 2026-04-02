# TSK-03-02: 사용자별 LLM API 구현 - 설계 문서

> 사용자별 LLM 설정 CRUD API와 연결 테스트 엔드포인트를 구현한다.

**작성일:** 2026-04-02
**상태:** Design
**참조:** PRD 3.2.2 / TRD 3.4 / TSK-03-01

---

## 1. 현재 상태

### 1.1 TSK-03-01에서 구현된 User 모델

`backend/app/models/user.rb`에 다음이 이미 구현되어 있다:

| 메서드/속성 | 설명 |
|------------|------|
| `encrypts :llm_api_key` | API 키 암호화 저장 |
| `llm_provider` | string — `"anthropic"`, `"openai"` 등 |
| `llm_api_key` | encrypted string — 복호화된 평문 접근 |
| `llm_model` | string — `"claude-sonnet-4-6"`, `"gpt-4o"` 등 |
| `llm_base_url` | string — 커스텀 엔드포인트 (Ollama 등) |
| `#llm_configured?` | provider + api_key 모두 있으면 true |
| `#effective_llm_config` | 개인 설정 우선, 없으면 서버 기본값 해시 반환 |
| `.server_default_llm_config` | ENV 기반 서버 기본 LLM 설정 해시 |

### 1.2 기존 LLM 설정 API (서버 전체 공유)

`Api::V1::SettingsController`에 서버 전체 공유 LLM 설정 API가 존재한다:

- `GET /api/v1/settings/llm` — settings.yaml 기반 프리셋 조회
- `PUT /api/v1/settings/llm` — settings.yaml 프리셋 업데이트
- `POST /api/v1/settings/llm/test` — Sidecar 경유 LLM 연결 테스트

이 기존 API는 **서버 관리용**으로 유지하고, 신규 API는 **사용자 개인 설정용**으로 분리한다.

### 1.3 인증 방식

`ApplicationController`에서:
- `server_mode?` (`ENV["SERVER_MODE"] == "true"`) 시 JWT 인증 (Warden/Devise)
- 로컬 모드 시 `desktop@local` 자동 생성
- `before_action :authenticate_user!`로 인증 적용
- `current_user`로 현재 사용자 접근

### 1.4 Sidecar LLM 테스트 API

`SidecarClient#test_llm_connection(params)`:
- `POST /settings/llm/test`를 Sidecar에 호출
- params: `{ provider:, model:, auth_token:, base_url: }`
- timeout: 15초
- 성공 시 `{ success: true, ... }`, 실패 시 SidecarError 발생

---

## 2. 라우팅 설계

### 2.1 신규 라우트

`config/routes.rb`의 `namespace :api > namespace :v1` 블록 안에 추가:

```ruby
# User-scoped settings
namespace :user do
  resource :llm_settings, only: [:show, :update] do
    post :test, on: :collection
  end
end
```

### 2.2 생성되는 라우트

| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/api/v1/user/llm_settings` | `api/v1/user/llm_settings#show` |
| PUT/PATCH | `/api/v1/user/llm_settings` | `api/v1/user/llm_settings#update` |
| POST | `/api/v1/user/llm_settings/test` | `api/v1/user/llm_settings#test` |

### 2.3 설계 근거

- `resource :llm_settings` (단수형): 현재 사용자의 유일한 LLM 설정이므로 `resource`(단수) 사용
- `namespace :user`: 향후 사용자 관련 설정이 추가될 수 있으므로(프로필, 알림 등) namespace으로 분리
- `on: :collection`으로 `test` 액션 정의: `POST /api/v1/user/llm_settings/test` — 저장 전 테스트 목적이므로 member가 아닌 collection

---

## 3. 컨트롤러 설계

### 3.1 파일 위치

`backend/app/controllers/api/v1/user/llm_settings_controller.rb`

### 3.2 컨트롤러 구조

```ruby
module Api
  module V1
    module User
      class LlmSettingsController < ApplicationController
        before_action :authenticate_user!

        # GET /api/v1/user/llm_settings
        def show
          # ...
        end

        # PUT /api/v1/user/llm_settings
        def update
          # ...
        end

        # POST /api/v1/user/llm_settings/test
        def test
          # ...
        end

        private

        def llm_settings_params
          # ...
        end

        def mask_api_key(key)
          # ...
        end
      end
    end
  end
end
```

---

## 4. API 엔드포인트 상세

### 4.1 GET /api/v1/user/llm_settings — 내 LLM 설정 조회

**인증:** 필수 (JWT 또는 로컬 모드)

**요청:** 없음

**응답:** `200 OK`

```json
{
  "llm_settings": {
    "provider": "anthropic",
    "api_key_masked": "sk-a****5678",
    "model": "claude-sonnet-4-6",
    "base_url": null,
    "configured": true
  },
  "server_default": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "has_key": true
  }
}
```

**로직:**
1. `current_user`의 LLM 필드를 읽는다
2. `api_key`는 `mask_api_key`로 마스킹하여 반환
3. `configured`는 `current_user.llm_configured?` 결과
4. `server_default`로 서버 기본 설정 정보를 함께 반환 (프론트엔드에서 "서버 기본값 사용 중" 표시용)
   - server_default의 api_key는 노출하지 않고, `has_key`로 설정 여부만 반환

### 4.2 PUT /api/v1/user/llm_settings — 내 LLM 설정 변경

**인증:** 필수

**요청:** `Content-Type: application/json`

```json
{
  "llm_settings": {
    "provider": "anthropic",
    "api_key": "sk-ant-api03-xxxxx",
    "model": "claude-sonnet-4-6",
    "base_url": null
  }
}
```

**파라미터 규칙:**
- `provider`: 필수. `"anthropic"`, `"openai"` 중 하나
- `api_key`: 선택. 빈 문자열(`""`) 전송 시 기존 키 유지 (마스킹된 값을 그대로 보내는 경우 대비). `null` 전송 시 키 삭제
- `model`: 선택
- `base_url`: 선택. `null` 또는 빈 문자열 시 삭제

**응답:** `200 OK` — show 액션과 동일한 형태

```json
{
  "llm_settings": {
    "provider": "anthropic",
    "api_key_masked": "sk-a****xxxx",
    "model": "claude-sonnet-4-6",
    "base_url": null,
    "configured": true
  },
  "server_default": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "has_key": true
  }
}
```

**에러 응답:** `422 Unprocessable Entity`

```json
{
  "error": "provider는 필수입니다"
}
```

**로직:**
1. `llm_settings_params`로 Strong Parameters 허용
2. `api_key`가 빈 문자열이면 기존 값 유지 (params에서 제거)
3. `api_key`가 `null`이면 `nil`로 설정 (키 삭제)
4. `provider`가 빈 문자열 또는 `null`이면 모든 LLM 필드를 `nil`로 초기화 (설정 초기화 = 서버 기본값으로 폴백)
5. `current_user.update!(허용된 속성)`
6. 업데이트 후 show와 동일한 응답 반환

### 4.3 POST /api/v1/user/llm_settings/test — LLM 연결 테스트

**인증:** 필수

**요청:** `Content-Type: application/json`

```json
{
  "provider": "anthropic",
  "api_key": "sk-ant-api03-xxxxx",
  "model": "claude-sonnet-4-6",
  "base_url": null
}
```

**파라미터 규칙:**
- `provider`: 필수
- `model`: 필수
- `api_key`: 선택. 미전송 시 현재 사용자의 저장된 키 사용 (이미 저장된 키로 테스트하는 경우)
- `base_url`: 선택

**응답 (성공):** `200 OK`

```json
{
  "success": true,
  "message": "LLM 연결 성공",
  "response_time_ms": 1234
}
```

**응답 (실패):** `200 OK` (테스트 자체는 수행됨, 결과가 실패)

```json
{
  "success": false,
  "error": "Invalid API key"
}
```

**응답 (Sidecar 접속 불가):** `503 Service Unavailable`

```json
{
  "success": false,
  "error": "Sidecar 서비스에 연결할 수 없습니다"
}
```

**로직:**
1. `provider`, `model` 필수 파라미터 검증
2. `api_key`가 없으면 `current_user.llm_api_key`를 사용
3. `SidecarClient#test_llm_connection`에 `{ provider:, model:, auth_token:, base_url: }` 전달
   - 주의: Sidecar API는 `auth_token` 키를 사용하므로 `api_key` → `auth_token`으로 키 이름 변환
4. Sidecar 응답을 그대로 반환
5. `SidecarClient::ConnectionError` / `TimeoutError` 시 503 응답

---

## 5. API 키 마스킹 로직

### 5.1 `mask_api_key` 메서드

기존 `SettingsController#mask_token`과 동일한 로직을 재사용한다.

```ruby
def mask_api_key(key)
  return nil if key.blank?
  return "****" if key.length <= 8
  "#{key[0..3]}#{"*" * (key.length - 8)}#{key[-4..]}"
end
```

**예시:**
- `"sk-ant-api03-abcdefghij"` → `"sk-a**************ghij"`
- `"sk-1234"` → `"****"` (8자 이하)
- `nil` → `nil`

### 5.2 설계 근거

- 앞 4자 + 뒤 4자를 노출하여 사용자가 어떤 키인지 식별 가능
- 8자 이하 키는 전체 마스킹 (노출 의미 없음)
- `nil`은 `nil` 반환 (미설정 상태 표현)

---

## 6. 에러 핸들링

### 6.1 인증 실패

`ApplicationController#authenticate_user!`에서 처리:
- 서버 모드 + JWT 없음/만료 → `401 Unauthorized`
- 로컬 모드 → 항상 `desktop@local` 사용자로 통과

### 6.2 파라미터 에러

| 상황 | 응답 코드 | 메시지 |
|------|----------|--------|
| provider 누락 (update) | 422 | `provider는 필수입니다` |
| provider 누락 (test) | 400 | `provider는 필수입니다` |
| model 누락 (test) | 400 | `model은 필수입니다` |
| 잘못된 provider 값 | 422 | `provider는 anthropic, openai 중 하나여야 합니다` |

### 6.3 Sidecar 에러 (test 액션)

| 예외 | 응답 코드 | 처리 |
|------|----------|------|
| `SidecarClient::ConnectionError` | 503 | `{ success: false, error: "Sidecar 서비스에 연결할 수 없습니다" }` |
| `SidecarClient::TimeoutError` | 503 | `{ success: false, error: "LLM 연결 테스트 시간 초과" }` |
| `SidecarClient::SidecarError` | 503 | `{ success: false, error: e.message }` |

### 6.4 모델 저장 에러

| 예외 | 응답 코드 | 처리 |
|------|----------|------|
| `ActiveRecord::RecordInvalid` | 422 | `{ error: e.record.errors.full_messages.join(", ") }` |

---

## 7. 구현 상세

### 7.1 컨트롤러 전체 코드

```ruby
module Api
  module V1
    module User
      class LlmSettingsController < ApplicationController
        before_action :authenticate_user!

        VALID_PROVIDERS = %w[anthropic openai].freeze

        # GET /api/v1/user/llm_settings
        def show
          render json: build_response
        end

        # PUT /api/v1/user/llm_settings
        def update
          attrs = normalize_params

          # provider가 빈값이면 전체 초기화 (서버 기본값 폴백)
          if attrs[:llm_provider].blank?
            current_user.update!(
              llm_provider: nil,
              llm_api_key: nil,
              llm_model: nil,
              llm_base_url: nil
            )
            return render json: build_response
          end

          # provider 유효성 검증
          unless VALID_PROVIDERS.include?(attrs[:llm_provider])
            return render json: { error: "provider는 #{VALID_PROVIDERS.join(', ')} 중 하나여야 합니다" },
                          status: :unprocessable_entity
          end

          current_user.update!(attrs)
          render json: build_response
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") },
                 status: :unprocessable_entity
        end

        # POST /api/v1/user/llm_settings/test
        def test
          provider = params.require(:provider)
          model = params.require(:model)

          api_key = params[:api_key].presence || current_user.llm_api_key
          base_url = params[:base_url].presence

          test_params = {
            provider: provider,
            model: model,
            auth_token: api_key,
            base_url: base_url
          }.compact

          result = SidecarClient.new.test_llm_connection(test_params)
          render json: result
        rescue ActionController::ParameterMissing => e
          render json: { success: false, error: "#{e.param}은(는) 필수입니다" },
                 status: :bad_request
        rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
          render json: { success: false, error: e.message },
                 status: :service_unavailable
        rescue SidecarClient::SidecarError => e
          render json: { success: false, error: e.message },
                 status: :service_unavailable
        end

        private

        def normalize_params
          p = params.require(:llm_settings).permit(:provider, :api_key, :model, :base_url)
          attrs = {}

          attrs[:llm_provider] = p[:provider]
          attrs[:llm_model] = p[:model]
          attrs[:llm_base_url] = p[:base_url].presence  # 빈 문자열 → nil

          # api_key 처리: 빈 문자열이면 기존 유지, nil이면 삭제, 값이면 갱신
          if p.key?(:api_key)
            if p[:api_key].blank? && p[:api_key] != nil
              # 빈 문자열 → 기존 값 유지 (attrs에서 제외)
            else
              attrs[:llm_api_key] = p[:api_key]
            end
          end

          attrs
        end

        def build_response
          user = current_user
          server_default = User.server_default_llm_config

          {
            llm_settings: {
              provider: user.llm_provider,
              api_key_masked: mask_api_key(user.llm_api_key),
              model: user.llm_model,
              base_url: user.llm_base_url,
              configured: user.llm_configured?
            },
            server_default: {
              provider: server_default[:provider],
              model: server_default[:model],
              has_key: server_default[:api_key].present?
            }
          }
        end

        def mask_api_key(key)
          return nil if key.blank?
          return "****" if key.length <= 8
          "#{key[0..3]}#{"*" * (key.length - 8)}#{key[-4..]}"
        end
      end
    end
  end
end
```

### 7.2 라우트 추가

```ruby
# config/routes.rb — namespace :api > namespace :v1 블록 안에 추가

# User-scoped settings
namespace :user do
  resource :llm_settings, only: [:show, :update] do
    post :test, on: :collection
  end
end
```

---

## 8. 변경 파일 목록

| 파일 | 변경 내용 | 신규/수정 |
|------|----------|----------|
| `app/controllers/api/v1/user/llm_settings_controller.rb` | 컨트롤러 구현 | **신규** |
| `config/routes.rb` | `namespace :user` + `resource :llm_settings` 라우트 추가 | 수정 |
| `spec/requests/api/v1/user/llm_settings_spec.rb` | API 통합 테스트 | **신규** |

---

## 9. 테스트 전략

### 9.1 Request Spec (`spec/requests/api/v1/user/llm_settings_spec.rb`)

#### 9.1.1 GET /api/v1/user/llm_settings

```ruby
describe "GET /api/v1/user/llm_settings" do
  context "LLM 미설정 사용자" do
    it "configured: false를 반환한다" do
      get api_v1_user_llm_settings_path, headers: auth_headers(user)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["llm_settings"]["configured"]).to be false
      expect(body["llm_settings"]["provider"]).to be_nil
    end
  end

  context "LLM 설정된 사용자" do
    let(:user) { create(:user, :with_llm_config) }

    it "마스킹된 api_key와 함께 설정을 반환한다" do
      get api_v1_user_llm_settings_path, headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["llm_settings"]["configured"]).to be true
      expect(body["llm_settings"]["provider"]).to eq("anthropic")
      expect(body["llm_settings"]["api_key_masked"]).not_to eq(user.llm_api_key)
      expect(body["llm_settings"]["api_key_masked"]).to include("****")
    end
  end

  context "server_default 정보" do
    it "서버 기본 LLM 설정 정보를 반환한다" do
      get api_v1_user_llm_settings_path, headers: auth_headers(user)
      body = JSON.parse(response.body)
      expect(body["server_default"]).to have_key("provider")
      expect(body["server_default"]).to have_key("has_key")
    end
  end
end
```

#### 9.1.2 PUT /api/v1/user/llm_settings

```ruby
describe "PUT /api/v1/user/llm_settings" do
  it "LLM 설정을 저장한다" do
    put api_v1_user_llm_settings_path, params: {
      llm_settings: {
        provider: "anthropic",
        api_key: "sk-ant-new-key",
        model: "claude-sonnet-4-6"
      }
    }, headers: auth_headers(user)

    expect(response).to have_http_status(:ok)
    user.reload
    expect(user.llm_provider).to eq("anthropic")
    expect(user.llm_api_key).to eq("sk-ant-new-key")
  end

  it "api_key 빈 문자열 시 기존 키를 유지한다" do
    user.update!(llm_provider: "anthropic", llm_api_key: "sk-existing")
    put api_v1_user_llm_settings_path, params: {
      llm_settings: { provider: "anthropic", api_key: "", model: "claude-sonnet-4-6" }
    }, headers: auth_headers(user)

    expect(user.reload.llm_api_key).to eq("sk-existing")
  end

  it "provider 빈값 시 전체 초기화한다" do
    user.update!(llm_provider: "anthropic", llm_api_key: "sk-xxx")
    put api_v1_user_llm_settings_path, params: {
      llm_settings: { provider: "" }
    }, headers: auth_headers(user)

    user.reload
    expect(user.llm_provider).to be_nil
    expect(user.llm_api_key).to be_nil
  end

  it "잘못된 provider 값 시 422를 반환한다" do
    put api_v1_user_llm_settings_path, params: {
      llm_settings: { provider: "invalid" }
    }, headers: auth_headers(user)

    expect(response).to have_http_status(:unprocessable_entity)
  end
end
```

#### 9.1.3 POST /api/v1/user/llm_settings/test

```ruby
describe "POST /api/v1/user/llm_settings/test" do
  before do
    allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
      .and_return({ "success" => true, "message" => "ok" })
  end

  it "LLM 연결 테스트를 수행한다" do
    post test_api_v1_user_llm_settings_path, params: {
      provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
    }, headers: auth_headers(user)

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)["success"]).to be true
  end

  it "api_key 미전송 시 저장된 키를 사용한다" do
    user.update!(llm_api_key: "sk-saved-key")
    expect_any_instance_of(SidecarClient).to receive(:test_llm_connection)
      .with(hash_including(auth_token: "sk-saved-key"))
      .and_return({ "success" => true })

    post test_api_v1_user_llm_settings_path, params: {
      provider: "anthropic", model: "claude-sonnet-4-6"
    }, headers: auth_headers(user)
  end

  it "Sidecar 접속 불가 시 503을 반환한다" do
    allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
      .and_raise(SidecarClient::ConnectionError, "Connection refused")

    post test_api_v1_user_llm_settings_path, params: {
      provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
    }, headers: auth_headers(user)

    expect(response).to have_http_status(:service_unavailable)
  end

  it "provider 누락 시 400을 반환한다" do
    post test_api_v1_user_llm_settings_path, params: {
      model: "claude-sonnet-4-6"
    }, headers: auth_headers(user)

    expect(response).to have_http_status(:bad_request)
  end
end
```

### 9.2 인증 테스트

```ruby
context "미인증 요청 (서버 모드)" do
  before { allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true) }

  it "GET 시 401을 반환한다" do
    get api_v1_user_llm_settings_path
    expect(response).to have_http_status(:unauthorized)
  end

  it "PUT 시 401을 반환한다" do
    put api_v1_user_llm_settings_path, params: { llm_settings: { provider: "anthropic" } }
    expect(response).to have_http_status(:unauthorized)
  end

  it "POST test 시 401을 반환한다" do
    post test_api_v1_user_llm_settings_path, params: { provider: "anthropic", model: "x" }
    expect(response).to have_http_status(:unauthorized)
  end
end
```

---

## 10. 디렉토리 구조

```
backend/
├── app/controllers/api/v1/
│   ├── user/                              # 신규 디렉토리
│   │   └── llm_settings_controller.rb     # 신규
│   ├── settings_controller.rb             # 기존 (서버 전체 LLM 설정)
│   └── ...
├── config/
│   └── routes.rb                          # 수정
└── spec/requests/api/v1/
    └── user/                              # 신규 디렉토리
        └── llm_settings_spec.rb           # 신규
```

---

## 11. 향후 고려사항 (이 태스크 범위 밖)

| 항목 | 관련 태스크 | 설명 |
|------|------------|------|
| MeetingSummarizationJob에서 사용자별 LLM 사용 | TSK-03-02 후속 또는 별도 | `current_user.effective_llm_config`을 Sidecar에 전달하는 작업은 요약 Job 수정이 필요하며, 이 컨트롤러 태스크와 별도로 다룰 수 있음 |
| 프론트엔드 LLM 설정 UI | TSK-03-03 | 이 API를 호출하는 프론트엔드 UI |
| provider별 모델 목록 제공 | 미정 | 프론트엔드에서 모델 드롭다운을 위한 API (하드코딩 또는 API 추가) |

---

## 12. 체크리스트

- [ ] `app/controllers/api/v1/user/` 디렉토리 생성
- [ ] `llm_settings_controller.rb` 구현
- [ ] `config/routes.rb`에 라우트 추가
- [ ] `rails routes | grep llm_settings`로 라우트 확인
- [ ] `spec/requests/api/v1/user/llm_settings_spec.rb` 작성
- [ ] 전체 테스트 통과 확인 (`bundle exec rspec`)
