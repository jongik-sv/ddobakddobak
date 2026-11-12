require "rails_helper"
require "tmpdir"

RSpec.describe "Api::V1::Settings whiteboard", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }
  let(:tmp_dir) { Dir.mktmpdir("wb-settings") }
  let(:tmp_path) { File.join(tmp_dir, "settings.yaml") }

  before do
    # 실제 settings.yaml 보호: SETTINGS_PATH 를 임시 파일로 격리
    # 컨트롤러 상수는 로드 시점에 AppSettings::SETTINGS_PATH 를 복사하므로, 먼저 로드해 둔 뒤 스텁한다
    # (스텁된 값이 원본으로 굳는 오염 방지).
    Api::V1::SettingsController
    stub_const("AppSettings::SETTINGS_PATH", tmp_path)
    stub_const("Api::V1::SettingsController::SETTINGS_PATH", tmp_path)
    allow(LlmService).to receive(:claude_cli_available?).and_return(true)
    allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
  end

  after { FileUtils.remove_entry(tmp_dir) if File.exist?(tmp_dir) }

  describe "GET /api/v1/settings/whiteboard" do
    it "기본값은 server_claude" do
      login_as(member)
      get "/api/v1/settings/whiteboard"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("web_mode" => "server_claude", "server_claude_available" => true)
    end

    it "저장된 값이 copy 면 copy" do
      File.write(tmp_path, YAML.dump("whiteboard" => { "web_mode" => "copy" }))
      login_as(member)
      get "/api/v1/settings/whiteboard"
      expect(JSON.parse(response.body)["web_mode"]).to eq("copy")
    end

    it "claude CLI 부재 시 server_claude_available false" do
      allow(LlmService).to receive(:claude_cli_available?).and_return(false)
      login_as(member)
      get "/api/v1/settings/whiteboard"
      expect(JSON.parse(response.body)["server_claude_available"]).to eq(false)
    end

    it "저장된 값이 잘못되면 server_claude" do
      File.write(tmp_path, YAML.dump("whiteboard" => { "web_mode" => "bogus" }))
      login_as(member)
      get "/api/v1/settings/whiteboard"
      expect(JSON.parse(response.body)["web_mode"]).to eq("server_claude")
    end
  end

  describe "PUT /api/v1/settings/whiteboard" do
    it "admin 은 저장하고 GET 과 같은 본문을 받는다" do
      login_as(admin)
      put "/api/v1/settings/whiteboard", params: { web_mode: "server_claude" }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("web_mode" => "server_claude", "server_claude_available" => true)
      expect(YAML.safe_load(File.read(tmp_path)).dig("whiteboard", "web_mode")).to eq("server_claude")
    end

    it "기존 설정 키를 보존한다" do
      File.write(tmp_path, YAML.dump("stt" => { "engine" => "x" }))
      login_as(admin)
      put "/api/v1/settings/whiteboard", params: { web_mode: "copy" }
      expect(YAML.safe_load(File.read(tmp_path))["stt"]).to eq("engine" => "x")
    end

    it "비admin 은 403 (server_mode)" do
      login_as(member)
      put "/api/v1/settings/whiteboard", params: { web_mode: "server_claude" }
      expect(response).to have_http_status(:forbidden)
      expect(File.exist?(tmp_path)).to eq(false)
    end

    it "잘못된 값은 422" do
      login_as(admin)
      put "/api/v1/settings/whiteboard", params: { web_mode: "nope" }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(File.exist?(tmp_path)).to eq(false)
    end

    it "web_mode 누락도 422" do
      login_as(admin)
      put "/api/v1/settings/whiteboard", params: {}
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end

RSpec.describe LlmService, ".claude_cli_available?" do
  it "CLAUDE_CLI_PATH 절대경로가 실행 가능하면 true, 없으면 false" do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("CLAUDE_CLI_PATH", "claude").and_return("/bin/sh")
    expect(LlmService.claude_cli_available?).to eq(true)
    allow(ENV).to receive(:fetch).with("CLAUDE_CLI_PATH", "claude").and_return("/nonexistent/claude")
    expect(LlmService.claude_cli_available?).to eq(false)
  end
end
