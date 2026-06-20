require "rails_helper"

RSpec.describe "Api::V1::Settings admin authorization", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }

  # Stub SidecarClient and LlmService to avoid real external calls
  before do
    sidecar = instance_double(SidecarClient,
      stt_engine_info: { "current" => "whisper_cpp", "available" => %w[whisper_cpp], "model_loaded" => true },
      update_stt_engine: { "stt_engine" => "whisper_cpp", "model_loaded" => true },
      get_hf_settings: { "hf_token_masked" => "hf_***", "has_token" => true },
      update_hf_settings: { "hf_token_masked" => "hf_***", "has_token" => true }
    )
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(LlmService).to receive(:new).and_return(
      instance_double(LlmService, test_connection: { "success" => true })
    )

    # Stub YAML settings file I/O
    allow(File).to receive(:exist?).and_call_original
    allow(File).to receive(:exist?).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(true)
    allow(File).to receive(:read).and_call_original
    allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
      "stt" => { "engine" => "whisper_cpp" },
      "llm" => { "active_preset" => "anthropic", "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } } },
      "hf" => { "token" => "hf_test" }
    }))
    allow(File).to receive(:write).and_call_original
    allow(File).to receive(:write).with(Api::V1::SettingsController::SETTINGS_PATH, anything).and_return(true)
  end

  # ============================================================
  # Server mode: admin user => allowed
  # ============================================================
  describe "server mode — admin user" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(admin)
    end

    it "POST /api/v1/settings/stt_engine succeeds" do
      post "/api/v1/settings/stt_engine", params: { engine: "whisper_cpp" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "PUT /api/v1/settings/llm succeeds" do
      put "/api/v1/settings/llm", params: { active_preset: "anthropic" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "POST /api/v1/settings/llm/test succeeds" do
      post "/api/v1/settings/llm/test", params: { provider: "anthropic", model: "claude-sonnet-4-6" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "PUT /api/v1/settings/hf succeeds" do
      put "/api/v1/settings/hf", params: { hf_token: "hf_newtoken" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    # Read endpoints should still be accessible
    it "GET /api/v1/settings succeeds" do
      get "/api/v1/settings"
      expect(response).to have_http_status(:ok)
    end

    it "GET /api/v1/settings/llm succeeds" do
      get "/api/v1/settings/llm"
      expect(response).to have_http_status(:ok)
    end

    it "GET /api/v1/settings/hf succeeds" do
      get "/api/v1/settings/hf"
      expect(response).to have_http_status(:ok)
    end
  end

  # ============================================================
  # Server mode: member user => forbidden on write endpoints
  # ============================================================
  describe "server mode — member user" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(member)
    end

    it "POST /api/v1/settings/stt_engine returns 403" do
      post "/api/v1/settings/stt_engine", params: { engine: "whisper_cpp" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("Forbidden")
    end

    it "PUT /api/v1/settings/llm returns 403" do
      put "/api/v1/settings/llm", params: { active_preset: "anthropic" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("Forbidden")
    end

    it "POST /api/v1/settings/llm/test returns 403" do
      post "/api/v1/settings/llm/test", params: { provider: "anthropic", model: "claude-sonnet-4-6" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("Forbidden")
    end

    it "PUT /api/v1/settings/hf returns 403" do
      put "/api/v1/settings/hf", params: { hf_token: "hf_newtoken" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("Forbidden")
    end

    # Read endpoints should still be accessible for members
    it "GET /api/v1/settings succeeds" do
      get "/api/v1/settings"
      expect(response).to have_http_status(:ok)
    end

    it "GET /api/v1/settings/llm succeeds" do
      get "/api/v1/settings/llm"
      expect(response).to have_http_status(:ok)
    end

    it "GET /api/v1/settings/hf succeeds" do
      get "/api/v1/settings/hf"
      expect(response).to have_http_status(:ok)
    end
  end

  # ============================================================
  # Global chat model (chat_model top-level field)
  # ============================================================
  describe "global chat_model" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(admin)
    end

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

    it "PUT /api/v1/settings/llm with chat_model persists it under llm.chat_model" do
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_path, content|
          written = YAML.safe_load(content)
          true
        end

      put "/api/v1/settings/llm", params: { chat_model: "claude-haiku-4" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(written.dig("llm", "chat_model")).to eq("claude-haiku-4")
    end

    it "PUT /api/v1/settings/llm sets ENV[\"CHAT_LLM_MODEL\"] from chat_model" do
      # write→read 라운드트립 시뮬레이션: 저장된 내용이 이후 load_settings 재읽기에 보인다.
      # (sync_active_llm_to_env 가 저장 직후 파일을 다시 읽어 ENV 를 갱신하기 때문)
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_path, content|
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: { chat_model: "claude-haiku-4" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(ENV["CHAT_LLM_MODEL"]).to eq("claude-haiku-4")
    end

    it "GET /api/v1/settings/llm returns chat_model as a top-level field" do
      allow(File).to receive(:read).and_call_original
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "stt" => { "engine" => "whisper_cpp" },
        "llm" => {
          "active_preset" => "anthropic",
          "chat_model" => "claude-haiku-4",
          "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } }
        },
        "hf" => { "token" => "hf_test" }
      }))

      get "/api/v1/settings/llm"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["chat_model"]).to eq("claude-haiku-4")
    end

    it "PUT /api/v1/settings/llm with empty chat_model clears it (nil) and deletes ENV" do
      ENV["CHAT_LLM_MODEL"] = "stale-model"
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_path, content|
          written = YAML.safe_load(content)
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: { chat_model: "" }, as: :json

      expect(response).to have_http_status(:ok)
      expect(written.dig("llm", "chat_model")).to be_nil
      expect(ENV.key?("CHAT_LLM_MODEL")).to be(false)
    end
  end

  # ============================================================
  # Global chat (independent provider)
  # ============================================================
  describe "global chat (independent provider)" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(admin)
    end

    around do |example|
      keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
      prev = keys.index_with { |k| ENV[k] }
      example.run
      keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
    end

    it "persists chat sub-hash under llm.chat" do
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content)
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: {
        chat: { preset_id: "ollama", provider: "openai", auth_token: "chat-key",
                base_url: "http://localhost:11434/v1", model: "llama-3.1-8b" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      chat = written.dig("llm", "chat")
      expect(chat["provider"]).to eq("openai")
      expect(chat["auth_token"]).to eq("chat-key")
      expect(chat["base_url"]).to eq("http://localhost:11434/v1")
      expect(chat["model"]).to eq("llama-3.1-8b")
      expect(chat["preset_id"]).to eq("ollama")
    end

    it "does not overwrite stored auth_token when blank auth_token is sent" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "existing-key", "model" => "m1" } }
      }))
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content); true
        end

      put "/api/v1/settings/llm", params: {
        chat: { provider: "openai", auth_token: "", model: "m2", base_url: "http://h/v1" }
      }, as: :json

      expect(written.dig("llm", "chat", "auth_token")).to eq("existing-key")
      expect(written.dig("llm", "chat", "model")).to eq("m2")
    end

    it "clears llm.chat when chat.provider is blank" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "k", "model" => "m" } }
      }))
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content); true
        end

      put "/api/v1/settings/llm", params: { chat: { provider: "" }, chat_model: "fallback-model" }, as: :json

      expect(written.dig("llm", "chat")).to be_nil
      expect(written.dig("llm", "chat_model")).to eq("fallback-model")
    end

    it "GET /settings/llm masks chat.auth_token" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "sk-chat-secret-1234",
                               "base_url" => "http://h/v1", "model" => "m" } }
      }))

      get "/api/v1/settings/llm"

      expect(response).to have_http_status(:ok)
      chat = response.parsed_body["chat"]
      expect(chat["auth_token_masked"]).to be_present
      expect(chat).not_to have_key("auth_token")
      expect(chat["provider"]).to eq("openai")
      expect(chat["model"]).to eq("m")
    end

    it "emits CHAT_LLM_* ENV from llm.chat on save" do
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: {
        chat: { provider: "openai", auth_token: "chat-key",
                base_url: "http://localhost:11434/v1", model: "llama-3.1-8b" }
      }, as: :json

      expect(ENV["CHAT_LLM_PROVIDER"]).to eq("openai")
      expect(ENV["CHAT_LLM_AUTH_TOKEN"]).to eq("chat-key")
      expect(ENV["CHAT_LLM_BASE_URL"]).to eq("http://localhost:11434/v1")
      expect(ENV["CHAT_LLM_MODEL"]).to eq("llama-3.1-8b")
    end

    it "deletes CHAT_LLM_PROVIDER/AUTH/BASE when chat is cleared, keeping legacy chat_model" do
      ENV["CHAT_LLM_PROVIDER"]   = "openai"
      ENV["CHAT_LLM_AUTH_TOKEN"] = "old"
      ENV["CHAT_LLM_BASE_URL"]   = "http://old/v1"
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "old", "model" => "m" } }
      }))
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: { chat: { provider: "" }, chat_model: "legacy-m" }, as: :json

      expect(ENV.key?("CHAT_LLM_PROVIDER")).to be(false)
      expect(ENV.key?("CHAT_LLM_AUTH_TOKEN")).to be(false)
      expect(ENV.key?("CHAT_LLM_BASE_URL")).to be(false)
      expect(ENV["CHAT_LLM_MODEL"]).to eq("legacy-m")
    end
  end

  # ============================================================
  # Local mode: bypasses admin check (any user can write)
  # ============================================================
  describe "local mode — member user" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(false)
      login_as(member)
    end

    it "POST /api/v1/settings/stt_engine succeeds" do
      post "/api/v1/settings/stt_engine", params: { engine: "whisper_cpp" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "PUT /api/v1/settings/llm succeeds" do
      put "/api/v1/settings/llm", params: { active_preset: "anthropic" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "POST /api/v1/settings/llm/test succeeds" do
      post "/api/v1/settings/llm/test", params: { provider: "anthropic", model: "claude-sonnet-4-6" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "PUT /api/v1/settings/hf succeeds" do
      put "/api/v1/settings/hf", params: { hf_token: "hf_newtoken" }, as: :json
      expect(response).to have_http_status(:ok)
    end
  end
end
