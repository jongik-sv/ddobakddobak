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

      it "show 응답에 chat_model을 포함한다" do
        user.update!(chat_llm_model: "claude-haiku-4-5")

        get "/api/v1/user/llm_settings"

        body = response.parsed_body
        expect(body["llm_settings"]["chat_model"]).to eq("claude-haiku-4-5")
      end

      # effective_chat_model: 4-tier 카스케이드가 실제로 답변할 모델의 표시명.
      # tier-2(개인 챗 모델 override)는 ENV와 무관하게 chat_llm_model.presence 가 이기므로
      # 결정적이다 → 잘못된 컬럼(예: chat_llm_model 직접)에 묶었으면 humanize 미적용으로 깨진다.
      it "effective_chat_model이 카스케이드 모델의 표시명을 반환한다" do
        user.update!(chat_llm_model: "claude-haiku-4-5")

        get "/api/v1/user/llm_settings"

        body = response.parsed_body
        expect(body["llm_settings"]["effective_chat_model"]).to eq("Claude Haiku 4")
      end
    end

    context "기본 사용자" do
      it "effective_chat_model이 비어있지 않은 표시명을 반환한다" do
        get "/api/v1/user/llm_settings"

        body = response.parsed_body
        expect(body["llm_settings"]["effective_chat_model"]).to be_a(String)
        expect(body["llm_settings"]["effective_chat_model"]).not_to be_empty
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

    # BUG(선택 안함 값 유실): provider만 비워 보내는 요청(model/base_url/api_key 키 자체를
    # 보내지 않음)은 "요약 선택 안함" 저장이지 전체 초기화가 아니다. reset_all 없이는
    # provider(=미설정 판정 기준)만 비우고 model/base_url/api_key 는 보존해 재선택 시
    # 프리필할 수 있어야 한다. 완전 초기화가 필요하면 reset_all:true 를 써야 한다.
    it "provider 빈값(reset_all 없음) 시 provider만 비우고 model/base_url/api_key는 보존한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx",
        llm_model: "claude-sonnet-4-6", llm_base_url: "http://localhost:11434/v1"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_configured?).to be(false)
      expect(user.llm_api_key).to eq("sk-xxx")
      expect(user.llm_model).to eq("claude-sonnet-4-6")
      expect(user.llm_base_url).to eq("http://localhost:11434/v1")

      # GET 에서도 잔존값이 그대로 노출되어야 프론트가 재선택 시 프리필할 수 있다.
      get "/api/v1/user/llm_settings"
      body = response.parsed_body
      expect(body["llm_settings"]["configured"]).to be false
      expect(body["llm_settings"]["provider"]).to be_nil
      expect(body["llm_settings"]["model"]).to eq("claude-sonnet-4-6")
      expect(body["llm_settings"]["base_url"]).to eq("http://localhost:11434/v1")
      expect(body["llm_settings"]["api_key_masked"]).to include("*")
    end

    it "provider null(reset_all 없음) 시에도 api_key를 보존한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-xxx")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: nil }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_api_key).to eq("sk-xxx")
    end

    it "provider 빈값 + model/base_url/api_key를 명시적으로 빈 값 전송 시 그 필드만 지운다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx",
        llm_model: "claude-sonnet-4-6", llm_base_url: "http://old.url"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "", model: "", base_url: "", api_key: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_model).to be_nil
      expect(user.llm_base_url).to be_nil
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

    it "chat_model을 저장하고 응답에 포함한다(마스킹 없음)" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "anthropic",
          api_key: "sk-ant-key-12345678",
          model: "claude-sonnet-4-6",
          chat_model: "claude-haiku-4-5"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.chat_llm_model).to eq("claude-haiku-4-5")

      body = response.parsed_body
      expect(body["llm_settings"]["chat_model"]).to eq("claude-haiku-4-5")
    end

    it "provider 빈값 + reset_all 시 chat_llm_model도 초기화한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx",
        llm_model: "claude-sonnet-4-6", chat_llm_model: "claude-haiku-4-5"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "", reset_all: true }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.chat_llm_model).to be_nil
    end

    it "챗 독립 설정을 저장하고 응답에 노출한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "anthropic", api_key: "sumkey", model: "claude-sonnet-4-20250514",
          chat_provider: "openai", chat_api_key: "chatkey",
          chat_model: "gpt-4o", chat_base_url: "http://localhost:11434/v1"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to eq("openai")
      expect(user.chat_llm_api_key).to eq("chatkey")
      expect(user.chat_llm_base_url).to eq("http://localhost:11434/v1")
      expect(user.chat_llm_model).to eq("gpt-4o")
      body = response.parsed_body
      expect(body.dig("llm_settings", "chat_provider")).to eq("openai")
      expect(body.dig("llm_settings", "chat_api_key_masked")).to be_present
      expect(body.dig("llm_settings", "chat_configured")).to be true
    end

    it "provider 빈값 + reset_all 시 chat_llm_* 도 모두 초기화한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx",
        chat_llm_provider: "openai", chat_llm_api_key: "chatkey",
        chat_llm_model: "gpt-4o", chat_llm_base_url: "http://localhost:11434/v1"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "", reset_all: true }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to be_nil
      expect(user.chat_llm_api_key).to be_nil
      expect(user.chat_llm_base_url).to be_nil
    end

    # ============================================================
    # BUG #2: 요약='선택 안함'(빈 provider, reset_all 없음) 저장이
    #          별도 설정된 AI-챗 provider(chat_llm_*)를 보존해야 한다.
    # ============================================================
    it "provider 빈값(reset_all 없음) 시 chat_llm_* 를 보존한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx", llm_model: "claude-sonnet-4-6",
        chat_llm_provider: "anthropic", chat_llm_api_key: "k"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      # 요약: provider만 비워짐, model/api_key는 보존(재선택 시 프리필)
      expect(user.llm_provider).to be_nil
      expect(user.llm_configured?).to be(false)
      expect(user.llm_api_key).to eq("sk-xxx")
      expect(user.llm_model).to eq("claude-sonnet-4-6")
      # 챗 컬럼은 보존
      expect(user.chat_llm_provider).to eq("anthropic")
      expect(user.chat_llm_api_key).to eq("k")
      expect(user.llm_enabled).to be(true)
    end

    # ============================================================
    # BUG(개인 챗 저장): 요약='선택 안함'(빈 provider, reset_all 없음) + chat_* 전송 시
    #   요약은 비우되 개인 챗 모델은 요청대로 저장해야 한다.
    #   (요약은 서버 기본을 쓰고 AI 챗만 개인 모델로 돌리는 조합 — 이전엔 저장 불가였다.)
    # ============================================================
    it "provider 빈값(reset_all 없음) + chat_* 전송 시 요약은 비우고 챗은 저장한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-xxx", llm_model: "claude-sonnet-4-6")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "",
          chat_provider: "openai", chat_api_key: "chatkey",
          chat_model: "nvidia/nemotron-3-ultra-550b-a55b",
          chat_base_url: "https://integrate.api.nvidia.com/v1"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      # 요약: provider만 비워짐, model/api_key는 보존(재선택 시 프리필)
      expect(user.llm_provider).to be_nil
      expect(user.llm_configured?).to be(false)
      expect(user.llm_api_key).to eq("sk-xxx")
      expect(user.llm_model).to eq("claude-sonnet-4-6")
      # 챗 컬럼은 요청대로 저장됨
      expect(user.chat_llm_provider).to eq("openai")
      expect(user.chat_llm_api_key).to eq("chatkey")
      expect(user.chat_llm_model).to eq("nvidia/nemotron-3-ultra-550b-a55b")
      expect(user.chat_llm_base_url).to eq("https://integrate.api.nvidia.com/v1")
      expect(user.llm_enabled).to be(true)

      body = response.parsed_body
      expect(body.dig("llm_settings", "chat_provider")).to eq("openai")
      expect(body.dig("llm_settings", "chat_configured")).to be true
    end

    # 요약='선택 안함' + 챗='요약과 동일'(chat_provider=null) 전송 시 개인 챗 provider 는 비운다.
    # (프론트가 항상 chat_* 를 보내므로, '요약과 동일' 재선택 = 개인 챗 해제 의도.)
    it "provider 빈값 + chat_provider=null 전송 시 개인 챗 provider 를 비운다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx",
        chat_llm_provider: "openai", chat_llm_api_key: "ck", chat_llm_model: "gpt-4o"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "", chat_provider: nil, chat_base_url: nil, chat_model: nil, chat_api_key: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to be_nil
      expect(user.chat_llm_model).to be_nil
    end

    it "provider 빈값 + reset_all 시 요약·챗 모두 초기화한다(전체 초기화 버튼)" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-xxx", llm_model: "claude-sonnet-4-6",
        chat_llm_provider: "anthropic", chat_llm_api_key: "k"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "", reset_all: true }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to be_nil
      expect(user.llm_api_key).to be_nil
      expect(user.chat_llm_provider).to be_nil
      expect(user.chat_llm_api_key).to be_nil
      expect(user.llm_enabled).to be(true)
    end

    it "chat_model 파라미터가 chat_llm_model 파라미터보다 우선한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: {
          provider: "anthropic", api_key: "sk-key",
          chat_model: "gpt-4o", chat_llm_model: "claude-haiku-4-5"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.chat_llm_model).to eq("gpt-4o")
    end

    # ============================================================
    # BUG(AI챗 '선택 안함' 값 유실): chat_provider='server' 센티넬(AI챗 카드의 '선택 안함')로
    #   전환해도 chat_model/chat_base_url/chat_api_key 는 보존해야 재선택 시 프리필된다.
    # ============================================================
    it "chat_provider='server'(AI챗 선택 안함) 저장 시 chat_model/base_url/api_key를 보존한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-sum",
        chat_llm_provider: "openai", chat_llm_api_key: "chatkey",
        chat_llm_model: "gpt-4o", chat_llm_base_url: "http://localhost:11434/v1"
      )

      # 프론트는 '선택 안함' 전환 시 chat_model/base_url/api_key 키 자체를 보내지 않는다
      # (보존 위임) — 그 계약대로 chat_provider만 보낸다.
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", chat_provider: "server" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to eq("server")
      expect(user.chat_llm_model).to eq("gpt-4o")
      expect(user.chat_llm_base_url).to eq("http://localhost:11434/v1")
      expect(user.chat_llm_api_key).to eq("chatkey")

      # server 센티넬은 effective_chat_llm_config 에서 항상 서버 기본으로 라우팅되어야 한다
      # (보존된 개인 챗 키가 있어도 우회되지 않음).
      expect(user.effective_chat_llm_config[:provider]).not_to eq("openai")
    end

    it "chat_provider=''(요약과 동일) 저장 시에도 chat_model/base_url/api_key를 보존한다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-sum",
        chat_llm_provider: "openai", chat_llm_api_key: "chatkey",
        chat_llm_model: "gpt-4o", chat_llm_base_url: "http://localhost:11434/v1"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", chat_provider: "" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to be_nil
      expect(user.chat_llm_model).to eq("gpt-4o")
      expect(user.chat_llm_base_url).to eq("http://localhost:11434/v1")
      expect(user.chat_llm_api_key).to eq("chatkey")
    end
  end

  # ============================================================
  # FIX 1: provider 전환 시 이전 provider의 키를 새 provider에 묶지 않는다
  # ============================================================
  describe "PUT provider 전환 시 stale key 처리 (FIX 1)" do
    it "(a) anthropic+키 → openai로 전환(키 미전송) 시 llm_api_key를 nil로 비운다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-x", llm_model: "claude-sonnet-4-6")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "openai", model: "gpt-4o" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to eq("openai")
      expect(user.llm_api_key).to be_nil
    end

    it "(b) provider 전환 + 새 키 전송 시 새 키를 저장한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-x")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "openai", api_key: "newkey", model: "gpt-4o" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to eq("openai")
      expect(user.llm_api_key).to eq("newkey")
    end

    it "(c) 동일 provider + 모델 변경(키 미전송) 시 기존 키를 보존한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-keep", llm_model: "claude-sonnet-4-6")

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", model: "claude-haiku-4-5" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_model).to eq("claude-haiku-4-5")
      expect(user.llm_api_key).to eq("sk-keep")
    end

    it "(d) chat_provider 전환(챗 키 미전송) 시 chat_llm_api_key를 nil로 비운다" do
      user.update!(
        llm_provider: "anthropic", llm_api_key: "sk-sum",
        chat_llm_provider: "anthropic", chat_llm_api_key: "sk-chat-old"
      )

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", chat_provider: "openai", chat_model: "gpt-4o" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.chat_llm_provider).to eq("openai")
      expect(user.chat_llm_api_key).to be_nil
    end
  end

  # ============================================================
  # FIX 3: provider 저장 시 개인 LLM을 (재)활성화한다
  # ============================================================
  describe "PUT provider 저장 시 llm_enabled 재활성화 (FIX 3)" do
    it "llm_enabled=false 사용자가 provider+키 저장 시 enabled가 true가 되고 configured가 된다" do
      user.update!(llm_enabled: false)

      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic", api_key: "sk-ant-key-12345678", model: "claude-sonnet-4-6" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_enabled).to be(true)
      expect(user.llm_configured?).to be(true)
    end
  end

  # ============================================================
  # POST /api/v1/user/llm_settings/models  (클라우드 모델 목록 프록시 조회)
  # ============================================================
  describe "POST /api/v1/user/llm_settings/models" do
    it "클라우드 provider 의 모델 목록을 반환한다" do
      allow(LlmService).to receive(:list_models).and_return(%w[claude-sonnet-5 claude-opus-4-8])

      post "/api/v1/user/llm_settings/models", params: { provider: "anthropic", api_key: "sk-x" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["models"]).to eq(%w[claude-sonnet-5 claude-opus-4-8])
    end

    it "api_key 미전송(마스킹) 시 저장된 개인 키로 조회한다" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-saved-key")
      expect(LlmService).to receive(:list_models)
        .with(hash_including(provider: "anthropic", api_key: "sk-saved-key")).and_return([])

      post "/api/v1/user/llm_settings/models", params: { provider: "anthropic" }, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "지원하지 않는 provider(CLI 등)면 빈 목록을 반환한다" do
      expect(LlmService).not_to receive(:list_models)

      post "/api/v1/user/llm_settings/models", params: { provider: "claude_cli" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["models"]).to eq([])
    end

    it "조회 실패 시 200 + 빈 목록으로 폴백한다" do
      allow(LlmService).to receive(:list_models).and_raise(LlmService::LlmError.new("boom"))

      post "/api/v1/user/llm_settings/models", params: { provider: "openai", api_key: "k" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["models"]).to eq([])
      expect(response.parsed_body["error"]).to be_present
    end

    it "provider 누락 시 400을 반환한다" do
      post "/api/v1/user/llm_settings/models", params: {}, as: :json

      expect(response).to have_http_status(:bad_request)
    end
  end

  # ============================================================
  # POST /api/v1/user/llm_settings/test
  # ============================================================
  describe "POST /api/v1/user/llm_settings/test" do
    let(:llm_double) { instance_double(LlmService) }

    before do
      allow(LlmService).to receive(:new).and_return(llm_double)
      allow(llm_double).to receive(:test_connection)
        .and_return({ "success" => true, "response_time_ms" => 1234 })
    end

    it "LLM 연결 테스트를 수행한다" do
      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test-key"
      }, as: :json

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["success"]).to be true
    end

    it "LlmService에 올바른 파라미터를 전달한다" do
      expect(LlmService).to receive(:new).with(
        llm_config: hash_including(
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          auth_token: "sk-test-key"
        )
      ).and_return(llm_double)

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test-key"
      }, as: :json
    end

    it "api_key 미전송 시 저장된 키를 사용한다" do
      user.update!(llm_api_key: "sk-saved-key")

      expect(LlmService).to receive(:new).with(
        llm_config: hash_including(auth_token: "sk-saved-key")
      ).and_return(llm_double)

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6"
      }, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "base_url을 전달한다" do
      expect(LlmService).to receive(:new).with(
        llm_config: hash_including(base_url: "http://localhost:11434/v1")
      ).and_return(llm_double)

      post "/api/v1/user/llm_settings/test", params: {
        provider: "openai", model: "qwen3.5:latest",
        api_key: "key", base_url: "http://localhost:11434/v1"
      }, as: :json
    end

    it "LLM 에러 시 실패 결과를 반환한다" do
      allow(llm_double).to receive(:test_connection)
        .and_return({ "success" => false, "error" => "Connection refused" })

      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-test"
      }, as: :json

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["success"]).to be false
      expect(body["error"]).to be_present
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
  # CLI provider 저장/테스트
  # ============================================================
  describe "CLI provider 저장/테스트" do
    it "claude_cli를 키 없이 저장하고 provider를 영속한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "claude_cli", model: "sonnet" }
      }, as: :json
      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_provider).to eq("claude_cli")
      expect(user.llm_configured?).to be(true)
      expect(user.effective_llm_config[:provider]).to eq("claude_cli")
      expect(user.effective_llm_config[:model]).to eq("sonnet")
    end

    it "POST test: CLI provider는 LlmService 호출 없이 success skip" do
      expect(LlmService).not_to receive(:new)
      post "/api/v1/user/llm_settings/test", params: { provider: "gemini_cli", model: "x" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["success"]).to be(true)
    end

    it "여전히 알 수 없는 provider는 422" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "bogus_provider" }
      }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
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

    it "미설정 키는 마스킹 문자를 반환한다" do
      get "/api/v1/user/llm_settings"

      body = response.parsed_body
      expect(body["llm_settings"]["api_key_masked"]).to eq("****")
    end
  end

  # ============================================================
  # 미인증 요청 (서버 모드)
  # ============================================================
  # 서버 모드에서 인증을 강제하는 경계는 "원격(비-loopback) 요청 + JWT 없음"이다.
  # loopback 요청은 의도적으로 desktop@local admin으로 폴백되므로(하이브리드 인증)
  # 미인증 401을 검증하려면 반드시 원격 IP를 흉내내야 한다.
  context "미인증 요청 (서버 모드, 원격)" do
    include_context "server mode"
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    it "GET 시 401을 반환한다" do
      get "/api/v1/user/llm_settings", headers: remote, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "PUT 시 401을 반환한다" do
      put "/api/v1/user/llm_settings", params: {
        llm_settings: { provider: "anthropic" }
      }, headers: remote, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "POST test 시 401을 반환한다" do
      post "/api/v1/user/llm_settings/test", params: {
        provider: "anthropic", model: "claude-sonnet-4-6"
      }, headers: remote, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
