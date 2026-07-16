require "rails_helper"

RSpec.describe User, "chat LLM config", type: :model do
  describe "migration" do
    it "adds chat_llm_model column to users table" do
      expect(User.column_names).to include("chat_llm_model")
    end
  end

  describe "#effective_chat_llm_config" do
    # ENV["CHAT_LLM_MODEL"] 가 다른 예제로 새지 않도록 보존/복원한다.
    around do |example|
      prev = ENV["CHAT_LLM_MODEL"]
      example.run
      if prev.nil?
        ENV.delete("CHAT_LLM_MODEL")
      else
        ENV["CHAT_LLM_MODEL"] = prev
      end
    end

    context "when chat_llm_model is set" do
      it "overrides only the model, keeping provider/auth_token/base_url" do
        user = build(:user,
          llm_provider: "openai",
          llm_api_key: "sk-user-key",
          llm_model: "gpt-4o",
          llm_base_url: "http://localhost:11434/v1",
          chat_llm_model: "gpt-4o-mini"
        )

        base = user.effective_llm_config
        chat = user.effective_chat_llm_config

        expect(chat[:model]).to eq("gpt-4o-mini")
        expect(chat[:provider]).to eq(base[:provider])
        expect(chat[:auth_token]).to eq(base[:auth_token])
        expect(chat[:base_url]).to eq(base[:base_url])
      end

      it "per-user column wins over ENV[\"CHAT_LLM_MODEL\"]" do
        ENV["CHAT_LLM_MODEL"] = "global-chat-model"
        user = build(:user,
          llm_provider: "anthropic",
          llm_api_key: "sk-user-key",
          llm_model: "claude-sonnet-4-6",
          chat_llm_model: "user-chat-model"
        )

        expect(user.effective_chat_llm_config[:model]).to eq("user-chat-model")
      end
    end

    context "when chat_llm_model is blank" do
      it "equals effective_llm_config when no ENV override" do
        ENV.delete("CHAT_LLM_MODEL")
        user = build(:user,
          llm_provider: "anthropic",
          llm_api_key: "sk-user-key",
          llm_model: "claude-sonnet-4-6",
          chat_llm_model: nil
        )

        expect(user.effective_chat_llm_config).to eq(user.effective_llm_config)
      end

      it "treats empty string the same as nil (falls back to summary model)" do
        ENV.delete("CHAT_LLM_MODEL")
        user = build(:user,
          llm_provider: "anthropic",
          llm_api_key: "sk-user-key",
          llm_model: "claude-sonnet-4-6",
          chat_llm_model: ""
        )

        expect(user.effective_chat_llm_config).to eq(user.effective_llm_config)
      end

      it "uses ENV[\"CHAT_LLM_MODEL\"] as a global override when set" do
        ENV["CHAT_LLM_MODEL"] = "global-chat-model"
        user = build(:user,
          llm_provider: "anthropic",
          llm_api_key: "sk-user-key",
          llm_model: "claude-sonnet-4-6",
          chat_llm_model: nil
        )

        base = user.effective_llm_config
        chat = user.effective_chat_llm_config

        expect(chat[:model]).to eq("global-chat-model")
        expect(chat[:provider]).to eq(base[:provider])
        expect(chat[:auth_token]).to eq(base[:auth_token])
        expect(chat[:base_url]).to eq(base[:base_url])
      end

      it "ignores blank ENV[\"CHAT_LLM_MODEL\"] (falls back to summary model)" do
        ENV["CHAT_LLM_MODEL"] = ""
        user = build(:user,
          llm_provider: "anthropic",
          llm_api_key: "sk-user-key",
          llm_model: "claude-sonnet-4-6",
          chat_llm_model: nil
        )

        expect(user.effective_chat_llm_config).to eq(user.effective_llm_config)
      end
    end

    context "global chat tier (no personal LLM at all)" do
      # 전역 챗 ENV. CHAT_LLM_MODEL 외 키도 보존/복원.
      around do |example|
        keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL]
        prev = keys.index_with { |k| ENV[k] }
        example.run
        keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
      end

      it "uses server_default_chat_llm_config when ENV[CHAT_LLM_PROVIDER] is set and user has no personal LLM" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-chat-key"
        ENV["CHAT_LLM_BASE_URL"]   = "http://localhost:11434/v1"
        ENV["CHAT_LLM_MODEL"]      = "llama-3.1-8b"
        user = build(:user, llm_provider: nil, llm_api_key: nil)

        cfg = user.effective_chat_llm_config
        expect(cfg[:provider]).to eq("openai")
        expect(cfg[:auth_token]).to eq("global-chat-key")
        expect(cfg[:base_url]).to eq("http://localhost:11434/v1")
        expect(cfg[:model]).to eq("llama-3.1-8b")
      end

      it "personal summary wins over global chat tier (tier 2 before tier 3)" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-chat-key"
        ENV["CHAT_LLM_MODEL"]      = "llama-3.1-8b"
        user = build(:user,
          llm_provider: "anthropic", llm_api_key: "sk-user", llm_model: "claude-sonnet-4-6", llm_enabled: true,
          chat_llm_model: nil
        )

        cfg = user.effective_chat_llm_config
        # 개인 요약 프로바이더를 따르고, 모델만 ENV override
        expect(cfg[:provider]).to eq("anthropic")
        expect(cfg[:auth_token]).to eq("sk-user")
        expect(cfg[:model]).to eq("llama-3.1-8b")
      end
    end

    context "personal summary present but disabled (llm_enabled: false)" do
      around do |example|
        keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
        prev = keys.index_with { |k| ENV[k] }
        example.run
        keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
      end

      it "skips tier 2 and uses global chat (tier 3) when CHAT_LLM_PROVIDER set, ignoring chat_llm_model column" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-key"
        ENV["CHAT_LLM_MODEL"]      = "global-model"
        ENV.delete("CHAT_LLM_BASE_URL")
        user = build(:user, llm_provider: "anthropic", llm_api_key: "sk-user",
                     llm_model: "claude-sonnet-4-6", llm_enabled: false,
                     chat_llm_model: "personal-chat-model")

        cfg = user.effective_chat_llm_config
        expect(cfg[:provider]).to eq("openai")            # global chat, not personal anthropic
        expect(cfg[:auth_token]).to eq("global-key")
        expect(cfg[:model]).to eq("global-model")          # NOT "personal-chat-model"
      end
    end

    context "chat_llm_provider = 'server' sentinel (force server, skip personal summary)" do
      around do |example|
        keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
        prev = keys.index_with { |k| ENV[k] }
        example.run
        keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
      end

      it "uses global chat (tier 3) even when a personal summary LLM is configured/enabled" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-chat-key"
        ENV["CHAT_LLM_MODEL"]      = "global-chat-model"
        ENV.delete("CHAT_LLM_BASE_URL")
        user = build(:user, llm_provider: "anthropic", llm_api_key: "sk-user",
                     llm_model: "claude-sonnet-4-6", llm_enabled: true,
                     chat_llm_provider: "server", chat_llm_model: "ignored-personal-chat")

        cfg = user.effective_chat_llm_config
        expect(cfg[:provider]).to eq("openai")            # 서버 챗, 개인 anthropic 아님
        expect(cfg[:auth_token]).to eq("global-chat-key")
        expect(cfg[:model]).to eq("global-chat-model")     # 개인 chat_llm_model 무시
      end

      it "falls back to server summary (tier 4), never the personal summary, when no CHAT_LLM_PROVIDER" do
        %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL].each { |k| ENV.delete(k) }
        user = build(:user, llm_provider: "anthropic", llm_api_key: "sk-user",
                     llm_model: "claude-sonnet-4-6", llm_enabled: true,
                     chat_llm_provider: "server")

        cfg = user.effective_chat_llm_config
        # 개인 요약의 프로바이더 키/모델이 새어나오지 않고 서버로 강제되어야 한다.
        expect(cfg[:auth_token]).not_to eq("sk-user")
        expect(cfg[:model]).not_to eq("claude-sonnet-4-6")
        expect(cfg).to eq(user.server_chat_llm_config)
      end
    end
  end

  describe ".server_default_chat_llm_config" do
    around do |example|
      keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
      prev = keys.index_with { |k| ENV[k] }
      example.run
      keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
    end

    it "builds a compact config from CHAT_LLM_* ENV" do
      ENV["CHAT_LLM_PROVIDER"]   = "openai"
      ENV["CHAT_LLM_AUTH_TOKEN"] = "k"
      ENV["CHAT_LLM_BASE_URL"]   = "http://x/v1"
      ENV["CHAT_LLM_MODEL"]      = "m"
      cfg = User.server_default_chat_llm_config
      expect(cfg).to eq(provider: "openai", auth_token: "k", base_url: "http://x/v1", model: "m")
    end
  end
end
