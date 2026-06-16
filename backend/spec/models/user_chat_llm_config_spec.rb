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
  end
end
