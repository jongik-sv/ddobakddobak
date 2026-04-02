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
        expect(config[:api_key]).to eq("sk-user-key")
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
        expect(config[:api_key]).to eq("sk-server-key")
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
        expect(config[:api_key]).to eq("sk-ant-key")
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
        expect(config[:api_key]).to eq("sk-openai-key")
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
        expect(config).not_to have_key(:api_key)
        expect(config).not_to have_key(:model)
      end
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
