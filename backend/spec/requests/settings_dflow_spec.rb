require "rails_helper"

RSpec.describe "Api::V1::Settings dflow", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }

  before do
    allow(File).to receive(:exist?).and_call_original
    allow(File).to receive(:exist?).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(true)
    allow(File).to receive(:read).and_call_original
    allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
      "dflow" => {
        "enabled" => true,
        "base_url" => "https://wbs-web.vercel.app",
        "api_secret" => "sk-dflow-secret-12345678"
      }
    }))
    allow(File).to receive(:write).and_call_original
    allow(File).to receive(:write).with(Api::V1::SettingsController::SETTINGS_PATH, anything).and_return(true)
  end

  # ============================================================
  # Server mode: admin user
  # ============================================================
  describe "server mode — admin user" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(admin)
    end

    it "GET /api/v1/settings/dflow returns masked api_secret and no raw value" do
      get "/api/v1/settings/dflow"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["enabled"]).to eq(true)
      expect(body["base_url"]).to eq("https://wbs-web.vercel.app")
      expect(body["api_secret_masked"]).to eq("sk-d...5678")
      expect(body).not_to have_key("api_secret")
    end

    it "GET returns safe defaults when dflow section is absent (no error)" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "stt" => { "engine" => "whisper_cpp" }
      }))

      get "/api/v1/settings/dflow"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["enabled"]).to eq(false)
      expect(body["api_secret_masked"]).to eq("****")
    end

    it "PUT /api/v1/settings/dflow updates enabled/base_url/api_secret" do
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content)
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/dflow", params: {
        enabled: false,
        base_url: "https://new.example.com",
        api_secret: "new-secret-token-99999999"
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(written.dig("dflow", "enabled")).to eq(false)
      expect(written.dig("dflow", "base_url")).to eq("https://new.example.com")
      expect(written.dig("dflow", "api_secret")).to eq("new-secret-token-99999999")

      body = response.parsed_body
      expect(body).not_to have_key("api_secret")
      expect(body["api_secret_masked"]).to eq(mask_token_for_spec("new-secret-token-99999999"))
    end

    it "PUT with blank api_secret keeps the existing stored value (present-only update)" do
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content)
          true
        end

      put "/api/v1/settings/dflow", params: {
        base_url: "https://changed.example.com",
        api_secret: ""
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(written.dig("dflow", "api_secret")).to eq("sk-dflow-secret-12345678")
      expect(written.dig("dflow", "base_url")).to eq("https://changed.example.com")
    end
  end

  # ============================================================
  # Server mode: member user => forbidden on write, read still allowed
  # ============================================================
  describe "server mode — member user" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(member)
    end

    it "GET /api/v1/settings/dflow succeeds" do
      get "/api/v1/settings/dflow"
      expect(response).to have_http_status(:ok)
    end

    it "PUT /api/v1/settings/dflow returns 403" do
      put "/api/v1/settings/dflow", params: { enabled: false }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["error"]).to eq("Forbidden")
    end
  end

  # ============================================================
  # Server mode: unauthenticated remote request => 401
  # ============================================================
  describe "미인증 요청 (서버 모드, 원격)" do
    include_context "server mode"
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    it "PUT 시 401을 반환한다" do
      put "/api/v1/settings/dflow", params: { enabled: false }, headers: remote, as: :json
      expect(response).to have_http_status(:unauthorized)
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

    it "PUT /api/v1/settings/dflow succeeds" do
      put "/api/v1/settings/dflow", params: { enabled: true }, as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  def mask_token_for_spec(token)
    return "****" if token.blank? || token.length <= 8
    "#{token[0..3]}...#{token[-4..]}"
  end
end
