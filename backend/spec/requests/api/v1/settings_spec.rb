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
