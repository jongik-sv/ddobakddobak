require "rails_helper"

RSpec.describe "Api::V1::User::LlmSettings", type: :request do
  let(:user) { create(:user) }

  before { login_as(user) }

  # ============================================================
  # GET /api/v1/user/llm_settings
  # ============================================================
  describe "GET /api/v1/user/llm_settings" do
    context "LLM 미설정 사용자" do
      it "configured: false를 반환한다" do
        get "/api/v1/user/llm_settings"

        expect(response).to have_http_status(:ok)
        body = response.parsed_body
        expect(body["llm_settings"]["configured"]).to be false
        expect(body["llm_settings"]["provider"]).to be_nil
        expect(body["llm_settings"]["api_key_masked"]).to be_nil
        expect(body["llm_settings"]["model"]).to be_nil
        expect(body["llm_settings"]["base_url"]).to be_nil
      end
    end

    context "LLM 설정된 사용자" do
      let(:user) { create(:user, :with_llm_config) }

      it "마스킹된 api_key와 함께 설정을 반환한다" do
        get "/api/v1/user/llm_settings"

        body = response.parsed_body
        expect(body["llm_settings"]["configured"]).to be true
        expect(body["llm_settings"]["provider"]).to eq("anthropic")
        expect(body["llm_settings"]["model"]).to eq("claude-sonnet-4-6")
        # api_key는 마스킹되어야 함
        expect(body["llm_settings"]["api_key_masked"]).not_to eq(user.llm_api_key)
        expect(body["llm_settings"]["api_key_masked"]).to include("*")
      end
    end

    context "server_default 정보" do
      it "서버 기본 LLM 설정 정보를 반환한다" do
        get "/api/v1/user/llm_settings"

        body = response.parsed_body
        expect(body).to have_key("server_default")
        expect(body["server_default"]).to have_key("provider")
        expect(body["server_default"]).to have_key("model")
        expect(body["server_default"]).to have_key("has_key")
      end
    end
  end

  # ============================================================
  # PUT /api/v1/user/llm_settings
  # ============================================================
  describe "PUT /api/v1/user/llm_settings" do
    it "LLM 설정을 저장한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "anthropic",
          api_key: "sk-ant-new-key-12345678",
          model: "claude-sonnet-4-6"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to eq("anthropic")
      expect(user.llm_api_key).to eq("sk-ant-new-key-12345678")
      expect(user.llm_model).to eq("claude-sonnet-4-6")

      body = response.parsed_body
      expect(body["llm_settings"]["configured"]).to be true
      expect(body["llm_settings"]["api_key_masked"]).to include("*")
    end

    it "api_key 빈 문자열 시 기존 키를 유지한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-existing-key")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", api_key: "", model: "claude-sonnet-4-6" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_api_key).to eq("sk-existing-key")
    end

    it "api_key가 null이면 키를 삭제한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-to-delete")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", api_key: nil, model: "claude-sonnet-4-6" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_api_key).to be_nil
    end

    it "provider 빈값 시 전체 초기화한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-xxx", llm_model: "claude-sonnet-4-6")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_api_key).to be_nil
      expect(user.llm_model).to be_nil
      expect(user.llm_base_url).to be_nil
    end

    it "provider null 시 전체 초기화한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-xxx")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: nil }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_api_key).to be_nil
    end

    it "잘못된 provider 값 시 422를 반환한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "invalid_provider" }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      body = response.parsed_body
      expect(body["error"]).to include("provider")
    end

    it "openai provider를 허용한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "openai",
          api_key: "sk-openai-key-12345678",
          model: "gpt-4o"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to eq("openai")
    end

    it "base_url을 설정한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "openai",
          api_key: "ollama-key-12345678",
          model: "qwen3.5:latest",
          base_url: "http://localhost:11434/v1"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_base_url).to eq("http://localhost:11434/v1")
    end

    it "base_url 빈 문자열 시 nil로 설정한다" do
      user.update!(llm_provider: "openai", llm_api_key: "key", llm_base_url: "http://old.url")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "openai", base_url: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_base_url).to be_nil
    end
  end

  # ============================================================
  # POST /api/v1/user/llm_settings/test
  # ============================================================
  describe "POST /api/v1/user/llm_settings/test" do
    before do
      allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .and_return({ "success" => true, "message" => "ok", "response_time_ms" => 1234 })
    end

    it "LLM 연결 테스트를 수행한다" do
      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test-key"
      }, as: :json

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["success"]).to be true
    end

    it "Sidecar에 올바른 파라미터를 전달한다" do
      expect_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .with(hash_including(
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          auth_token: "sk-test-key"
        ))
        .and_return({ "success" => true })

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test-key"
      }, as: :json
    end

    it "api_key 미전송 시 저장된 키를 사용한다" do
      user.update!(llm_api_key: "sk-saved-key")

      expect_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .with(hash_including(auth_token: "sk-saved-key"))
        .and_return({ "success" => true })

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6"
      }, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "base_url을 전달한다" do
      expect_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .with(hash_including(base_url: "http://localhost:11434/v1"))
        .and_return({ "success" => true })

      post "/api/v1/user/llm_settings/test", params: {
        provider: "openai", model: "qwen3.5:latest",
        api_key: "key", base_url: "http://localhost:11434/v1"
      }, as: :json
    end

    it "Sidecar ConnectionError 시 503을 반환한다" do
      allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .and_raise(SidecarClient::ConnectionError, "Connection refused")

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
      }, as: :json

      expect(response).to have_http_status(:service_unavailable)
      body = response.parsed_body
      expect(body["success"]).to be false
      expect(body["error"]).to be_present
    end

    it "Sidecar TimeoutError 시 503을 반환한다" do
      allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .and_raise(SidecarClient::TimeoutError, "Request timed out")

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
      }, as: :json

      expect(response).to have_http_status(:service_unavailable)
    end

    it "Sidecar SidecarError 시 503을 반환한다" do
      allow_any_instance_of(SidecarClient).to receive(:test_llm_connection)
        .and_raise(SidecarClient::SidecarError, "500 Internal Server Error")

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
      }, as: :json

      expect(response).to have_http_status(:service_unavailable)
    end

    it "provider 누락 시 400을 반환한다" do
      post "/api/v1/user/llm_settings/test", params: {
        model: "claude-sonnet-4-6"
      }, as: :json

      expect(response).to have_http_status(:bad_request)
    end

    it "model 누락 시 400을 반환한다" do
      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic"
      }, as: :json

      expect(response).to have_http_status(:bad_request)
    end
  end

  # ============================================================
  # API 키 마스킹 검증
  # ============================================================
  describe "API 키 마스킹" do
    it "긴 키는 앞 4자 + 뒤 4자를 보여준다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-ant-api03-abcdefghij")

      get "/api/v1/user/llm_settings"

      body = response.parsed_body
      masked = body["llm_settings"]["api_key_masked"]
      expect(masked).to start_with("sk-a")
      expect(masked).to end_with("ghij")
      expect(masked).to include("*")
    end

    it "8자 이하 키는 전체 마스킹한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-1234")

      get "/api/v1/user/llm_settings"

      body = response.parsed_body
      expect(body["llm_settings"]["api_key_masked"]).to eq("****")
    end

    it "미설정 키는 nil을 반환한다" do
      get "/api/v1/user/llm_settings"

      body = response.parsed_body
      expect(body["llm_settings"]["api_key_masked"]).to be_nil
    end
  end

  # ============================================================
  # 미인증 요청 (서버 모드)
  # ============================================================
  context "미인증 요청 (서버 모드)" do
    include_context "server mode"

    it "GET 시 401을 반환한다" do
      get "/api/v1/user/llm_settings", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "PUT 시 401을 반환한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic" }
      }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "POST test 시 401을 반환한다" do
      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6"
      }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
