require "rails_helper"

RSpec.describe User, "LLM settings", type: :model do
  describe "migration" do
    it "adds llm columns to users table" do
      columns = User.column_names
      expect(columns).to include("llm_provider")
      expect(columns).to include("llm_api_key")
      expect(columns).to include("llm_model")
      expect(columns).to include("llm_base_url")
    end
  end

  describe "LLM API key encryption" do
    it "encrypts llm_api_key in the database" do
      user = create(:user, llm_api_key: "sk-test-secret-key")
      raw = User.connection.select_value(
        "SELECT llm_api_key FROM users WHERE id = #{user.id}"
      )
      expect(raw).not_to eq("sk-test-secret-key")
      expect(raw).to be_present
    end

    it "decrypts llm_api_key when reading" do
      user = create(:user, llm_api_key: "sk-test-secret-key")
      expect(user.reload.llm_api_key).to eq("sk-test-secret-key")
    end

    it "allows nil llm_api_key" do
      user = create(:user, llm_api_key: nil)
      expect(user.llm_api_key).to be_nil
    end
  end

  describe "#llm_configured?" do
    it "returns true when provider and api_key are both present" do
      user = build(:user, llm_provider: "anthropic", llm_api_key: "sk-xxx")
      expect(user.llm_configured?).to be true
    end

    it "returns false when provider is missing" do
      user = build(:user, llm_provider: nil, llm_api_key: "sk-xxx")
      expect(user.llm_configured?).to be false
    end

    it "returns false when api_key is missing" do
      user = build(:user, llm_provider: "anthropic", llm_api_key: nil)
      expect(user.llm_configured?).to be false
    end

    it "returns false when both are missing" do
      user = build(:user)
      expect(user.llm_configured?).to be false
    end
  end

  describe "#effective_llm_config" do
    context "when user has personal LLM config" do
      it "returns user's config" do
        user = build(:user,
          llm_provider: "openai",
          llm_api_key: "sk-user-key",
          llm_model: "gpt-4o",
          llm_base_url: nil
        )
        config = user.effective_llm_config
        expect(config[:provider]).to eq("openai")
        expect(config[:auth_token]).to eq("sk-user-key")
        expect(config[:model]).to eq("gpt-4o")
        expect(config).not_to have_key(:base_url)
      end

      it "includes base_url when present" do
        user = build(:user,
          llm_provider: "openai",
          llm_api_key: "ollama",
          llm_model: "qwen3.5:latest",
          llm_base_url: "http://localhost:11434/v1"
        )
        config = user.effective_llm_config
        expect(config[:base_url]).to eq("http://localhost:11434/v1")
      end
    end

    context "when user has no LLM config" do
      it "falls back to server default" do
        user = build(:user, llm_provider: nil, llm_api_key: nil)
        allow(ENV).to receive(:fetch).and_call_original
        allow(ENV).to receive(:[]).and_call_original
        allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return("anthropic")
        allow(ENV).to receive(:[]).with("ANTHROPIC_AUTH_TOKEN").and_return("sk-server-key")
        allow(ENV).to receive(:[]).with("LLM_MODEL").and_return("claude-sonnet-4-6")
        allow(ENV).to receive(:[]).with("ANTHROPIC_BASE_URL").and_return(nil)

        config = user.effective_llm_config
        expect(config[:provider]).to eq("anthropic")
        expect(config[:auth_token]).to eq("sk-server-key")
        expect(config[:model]).to eq("claude-sonnet-4-6")
      end
    end
  end

  describe ".server_default_llm_config" do
    before do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:[]).and_call_original
    end

    context "with anthropic provider" do
      it "returns anthropic config from ENV" do
        allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return("anthropic")
        allow(ENV).to receive(:[]).with("ANTHROPIC_AUTH_TOKEN").and_return("sk-ant-key")
        allow(ENV).to receive(:[]).with("LLM_MODEL").and_return("claude-sonnet-4-6")
        allow(ENV).to receive(:[]).with("ANTHROPIC_BASE_URL").and_return(nil)

        config = User.server_default_llm_config
        expect(config[:provider]).to eq("anthropic")
        expect(config[:auth_token]).to eq("sk-ant-key")
        expect(config[:model]).to eq("claude-sonnet-4-6")
        expect(config).not_to have_key(:base_url)
      end
    end

    context "with openai provider" do
      it "returns openai config from ENV" do
        allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return("openai")
        allow(ENV).to receive(:[]).with("OPENAI_API_KEY").and_return("sk-openai-key")
        allow(ENV).to receive(:[]).with("LLM_MODEL").and_return("gpt-4o")
        allow(ENV).to receive(:[]).with("OPENAI_BASE_URL").and_return("https://api.openai.com/v1")

        config = User.server_default_llm_config
        expect(config[:provider]).to eq("openai")
        expect(config[:auth_token]).to eq("sk-openai-key")
        expect(config[:model]).to eq("gpt-4o")
        expect(config[:base_url]).to eq("https://api.openai.com/v1")
      end
    end

    context "with no ENV set" do
      it "defaults to anthropic provider" do
        allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return("anthropic")
        allow(ENV).to receive(:[]).with("ANTHROPIC_AUTH_TOKEN").and_return(nil)
        allow(ENV).to receive(:[]).with("LLM_MODEL").and_return(nil)
        allow(ENV).to receive(:[]).with("ANTHROPIC_BASE_URL").and_return(nil)

        config = User.server_default_llm_config
        expect(config[:provider]).to eq("anthropic")
        expect(config).not_to have_key(:auth_token)
        expect(config).not_to have_key(:model)
      end
    end
  end

  describe "CLI provider (키 없음)" do
    it "claude_cli + 키 없음이면 configured로 인정하고 effective_llm_config가 CLI config를 빌드한다" do
      user = create(:user, llm_provider: "claude_cli", llm_api_key: nil, llm_model: "sonnet", llm_enabled: true)
      expect(user.llm_configured?).to be(true)
      expect(user.llm_has_settings?).to be(true)
      cfg = user.effective_llm_config
      expect(cfg[:provider]).to eq("claude_cli")
      expect(cfg[:model]).to eq("sonnet")
    end

    it "비-CLI provider는 여전히 키를 요구한다(회귀 가드)" do
      user = create(:user, llm_provider: "anthropic", llm_api_key: nil, llm_enabled: true)
      expect(user.llm_configured?).to be(false)
    end
  end

  describe "#chat_llm_configured? (FIX 2: keyless cloud chat provider)" do
    it "키 없는 클라우드 챗 프로바이더(anthropic)는 configured가 아니다" do
      user = build(:user, chat_llm_provider: "anthropic", chat_llm_api_key: nil, chat_llm_base_url: nil)
      expect(user.chat_llm_configured?).to be(false)
    end

    it "키 없는 클라우드 챗 프로바이더는 effective_chat_llm_config가 요약(서버) 폴백으로 떨어진다(토큰리스 anthropic 아님)" do
      user = build(:user,
        llm_provider: "anthropic", llm_api_key: "sk-sum", llm_enabled: true,
        chat_llm_provider: "anthropic", chat_llm_api_key: nil, chat_llm_base_url: nil
      )
      cfg = user.effective_chat_llm_config
      # tier-2(요약) 폴백이 동작하면 요약 토큰이 들어온다. tier-1(토큰리스 챗)이면 auth_token이 없다.
      expect(cfg[:auth_token]).to eq("sk-sum")
    end

    it "로컬 챗 프로바이더(ollama + loopback base_url, 키 없음)는 configured다" do
      user = build(:user, chat_llm_provider: "ollama", chat_llm_api_key: nil,
                          chat_llm_base_url: "http://localhost:11434/v1")
      expect(user.chat_llm_configured?).to be(true)
    end

    it "CLI 챗 프로바이더(claude_cli, 키 없음)는 configured다" do
      user = build(:user, chat_llm_provider: "claude_cli", chat_llm_api_key: nil, chat_llm_base_url: nil)
      expect(user.chat_llm_configured?).to be(true)
    end

    it "키 있는 클라우드 챗 프로바이더(anthropic)는 configured다" do
      user = build(:user, chat_llm_provider: "anthropic", chat_llm_api_key: "sk-chat", chat_llm_base_url: nil)
      expect(user.chat_llm_configured?).to be(true)
    end
  end

  describe "#effective_chat_llm_config (전역 no-key cloud 챗 → 요약 폴백; AppSettings 게이트)" do
    # 전역 경로: 부팅/런타임이 AppSettings.chat_llm_env(llm) 를 CHAT_LLM_* ENV 로 적용한다.
    # 그 ENV 를 그대로 흉내 내어 리졸버(tier-3/tier-4) 동작을 검증한다.
    def stub_chat_env!(llm_cfg, summary:)
      env = AppSettings.chat_llm_env(llm_cfg)
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return(summary[:provider])
      allow(ENV).to receive(:[]).with("ANTHROPIC_AUTH_TOKEN").and_return(summary[:auth_token])
      allow(ENV).to receive(:[]).with("ANTHROPIC_BASE_URL").and_return(nil)
      allow(ENV).to receive(:[]).with("LLM_MODEL").and_return(summary[:model])
      allow(ENV).to receive(:[]).with("OPENAI_API_KEY").and_return(nil)
      allow(ENV).to receive(:[]).with("OPENAI_BASE_URL").and_return(nil)
      %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL].each do |k|
        allow(ENV).to receive(:[]).with(k).and_return(env[k])
      end
    end

    it "키 없는 클라우드 전역 챗(anthropic, no token)은 CHAT_LLM_* 미방출 → tier-4 순수 요약 모델 폴백" do
      user = build(:user) # 개인 설정 없음
      llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5", "auth_token" => "", "base_url" => "" } }
      stub_chat_env!(llm, summary: { provider: "anthropic", auth_token: "sk-sum", model: "claude-sonnet-4-6" })

      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("anthropic")
      expect(cfg[:model]).to eq("claude-sonnet-4-6") # 요약 모델, haiku 누수 없음
      expect(cfg[:auth_token]).to eq("sk-sum")       # 토큰리스 anthropic 아님
    end

    it "CLI 전역 챗(gemini_cli, no token)은 tier-3 로 gemini_cli config 를 반환한다" do
      user = build(:user)
      llm = { "chat" => { "provider" => "gemini_cli", "model" => "Gemini 3.5 Flash (Medium)" } }
      stub_chat_env!(llm, summary: { provider: "anthropic", auth_token: "sk-sum", model: "claude-sonnet-4-6" })

      cfg = user.effective_chat_llm_config
      expect(cfg[:provider]).to eq("gemini_cli")
      expect(cfg[:model]).to eq("Gemini 3.5 Flash (Medium)")
    end
  end

  describe "factory traits" do
    it "creates user with :with_llm_config trait" do
      user = create(:user, :with_llm_config)
      expect(user.llm_provider).to eq("anthropic")
      expect(user.llm_api_key).to eq("sk-ant-test-key-12345")
      expect(user.llm_model).to eq("claude-sonnet-4-6")
      expect(user.llm_configured?).to be true
    end

    it "creates user with :with_openai_config trait" do
      user = create(:user, :with_openai_config)
      expect(user.llm_provider).to eq("openai")
      expect(user.llm_api_key).to eq("sk-openai-test-key-12345")
      expect(user.llm_model).to eq("gpt-4o")
      expect(user.llm_configured?).to be true
    end

    it "creates user with :with_custom_endpoint trait" do
      user = create(:user, :with_custom_endpoint)
      expect(user.llm_provider).to eq("openai")
      expect(user.llm_base_url).to eq("http://localhost:11434/v1")
      expect(user.llm_configured?).to be true
    end
  end
end
