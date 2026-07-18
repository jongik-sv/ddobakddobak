require "rails_helper"

RSpec.describe "Api::V1::LlmProfiles", type: :request do
  let(:user) { create(:user) }
  let(:admin) { create(:user, :admin) }

  describe "personal 풀" do
    before { login_as(user) }

    it "CRUD 왕복 + 토큰 마스킹 + blank 토큰 유지" do
      post "/api/v1/llm_profiles", params: { profile: {
        name: "Gemini · 무료키", preset_id: "gemini", provider: "openai",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.5-flash", auth_token: "AIza-secret-1234567890"
      } }, as: :json
      expect(response).to have_http_status(:created)
      body = response.parsed_body["profile"]
      expect(body["auth_token_masked"]).to be_present
      expect(body.to_json).not_to include("AIza-secret")
      id = body["id"]

      get "/api/v1/llm_profiles"
      expect(response.parsed_body["profiles"].map { |p| p["id"] }).to include(id)

      patch "/api/v1/llm_profiles/#{id}", params: { profile: { model: "gemini-2.5-flash", auth_token: "" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(LlmProfile.find(id).auth_token).to eq("AIza-secret-1234567890") # blank = 유지
      expect(LlmProfile.find(id).model).to eq("gemini-2.5-flash")

      delete "/api/v1/llm_profiles/#{id}"
      expect(response).to have_http_status(:no_content)
      expect(LlmProfile.exists?(id)).to be false
    end

    it "타인 프로필은 404" do
      other = LlmProfile.create!(user: create(:user), name: "X", preset_id: "openai", provider: "openai")
      patch "/api/v1/llm_profiles/#{other.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:not_found)
      delete "/api/v1/llm_profiles/#{other.id}"
      expect(response).to have_http_status(:not_found)
    end

    it "잘못된 provider는 422" do
      post "/api/v1/llm_profiles", params: { profile: { name: "C", preset_id: "claude_cli", provider: "claude_cli" } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "server 풀 (server mode)" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      # after_server_pool_change가 settings.yaml을 재실체화한다 — 실제 디스크 I/O 방지 기본 스텁.
      # 재실체화 내용을 검증하는 개별 테스트는 File.exist?/read/write를 여기서 재스텁한다.
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(false)
      allow(File).to receive(:write).and_call_original
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything).and_return(true)
    end

    it "admin은 CRUD 가능, 풀은 user_id nil로 저장" do
      login_as(admin)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "anthropic", provider: "anthropic", auth_token: "sk-ant-xxxx-123456" } }, as: :json
      expect(response).to have_http_status(:created)
      expect(LlmProfile.last.user_id).to be_nil

      get "/api/v1/llm_profiles?scope=server"
      expect(response.parsed_body["profiles"].size).to eq(1)
    end

    it "비admin은 server 풀 접근 403" do
      login_as(user)
      get "/api/v1/llm_profiles?scope=server"
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "openai", provider: "openai" } }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "비admin은 server 풀 프로필 수정·삭제도 403" do
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
      login_as(user)
      patch "/api/v1/llm_profiles/#{sp.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      delete "/api/v1/llm_profiles/#{sp.id}"
      expect(response).to have_http_status(:forbidden)
    end

    # ============================================================
    # I-3: 서버 active/chat 프로필 삭제 시 참조만 제거하고 실체화 블록(평문 토큰 포함)이
    #   잔존해 sync_env 가 삭제된 자격증명을 재방출하던 회귀. 프로필에서 실체화된 블록만
    #   정리하고 CLI·수동 프리셋은 보존해야 한다.
    # ============================================================
    it "활성 서버 프로필 삭제 시 실체화된 요약 프리셋 블록(토큰)까지 정리한다" do
      keys = %w[LLM_PROVIDER LLM_MODEL LLM_MAX_INPUT_TOKENS LLM_MAX_OUTPUT_TOKENS
                OPENAI_API_KEY OPENAI_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL]
      prev_env = keys.index_with { |k| ENV[k] }

      login_as(admin)
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai",
                              model: "gpt-4o", auth_token: "sk-del-secret-123456")
      # 삭제 직전 yaml 상태: active 참조 + 이미 실체화된 프리셋 블록(토큰 포함) + 무관한 수동 프리셋.
      disk = { "llm" => {
        "active_profile_id" => sp.id,
        "active_preset" => "openai",
        "presets" => {
          "openai" => { "provider" => "openai", "auth_token" => "sk-del-secret-123456", "model" => "gpt-4o",
                        "max_input_tokens" => 200_000, "max_output_tokens" => 10_000 },
          "claude_cli" => { "provider" => "claude_cli", "model" => "sonnet" }
        }
      } }
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
      allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump(disk))
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }

      delete "/api/v1/llm_profiles/#{sp.id}"
      expect(response).to have_http_status(:no_content)

      cfg = YAML.safe_load(written)
      expect(cfg["llm"]).not_to have_key("active_profile_id")
      expect(cfg["llm"]["presets"]).not_to have_key("openai") # 실체화 블록 제거
      expect(cfg["llm"]["presets"]).to have_key("claude_cli") # 수동 프리셋은 보존
      expect(written).not_to include("sk-del-secret") # 평문 토큰 잔류 없음
      expect(ENV["ANTHROPIC_AUTH_TOKEN"].to_s).not_to include("sk-del-secret")
    ensure
      keys.each { |k| prev_env[k].nil? ? ENV.delete(k) : ENV[k] = prev_env[k] }
    end

    it "활성 서버 챗 프로필 삭제 시 실체화된 llm.chat 블록(토큰)까지 정리한다" do
      keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL]
      prev_env = keys.index_with { |k| ENV[k] }

      login_as(admin)
      cp = LlmProfile.create!(user_id: nil, name: "C", preset_id: "zai", provider: "anthropic",
                              base_url: "https://api.z.ai/api/anthropic", model: "glm-5.2",
                              auth_token: "zk-del-secret-123456")
      disk = { "llm" => {
        "chat_profile_id" => cp.id,
        "chat" => { "preset_id" => "zai", "provider" => "anthropic", "auth_token" => "zk-del-secret-123456",
                    "base_url" => "https://api.z.ai/api/anthropic", "model" => "glm-5.2" }
      } }
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
      allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump(disk))
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }

      delete "/api/v1/llm_profiles/#{cp.id}"
      expect(response).to have_http_status(:no_content)

      cfg = YAML.safe_load(written)
      expect(cfg["llm"]).not_to have_key("chat_profile_id")
      expect(cfg["llm"]).not_to have_key("chat") # 실체화 챗 블록 제거
      expect(written).not_to include("zk-del-secret")
      expect(ENV["CHAT_LLM_AUTH_TOKEN"].to_s).not_to include("zk-del-secret")
    ensure
      keys.each { |k| prev_env[k].nil? ? ENV.delete(k) : ENV[k] = prev_env[k] }
    end

    it "활성 서버 프로필 편집 시 yaml 재실체화" do
      # after_server_pool_change가 LLM_PROVIDER/OPENAI_API_KEY 등을 갱신한다 —
      # 다른 spec 파일과 같은 프로세스에서 돌 때 새는 것을 막기 위해 복원한다.
      keys = %w[LLM_PROVIDER LLM_MODEL LLM_MAX_INPUT_TOKENS LLM_MAX_OUTPUT_TOKENS
                OPENAI_API_KEY OPENAI_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL]
      prev_env = keys.index_with { |k| ENV[k] }

      login_as(admin)
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai", model: "old", auth_token: "sk-xxxx-12345678")
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
      allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump({ "llm" => { "active_profile_id" => sp.id } }))
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }
      patch "/api/v1/llm_profiles/#{sp.id}", params: { profile: { model: "gpt-4o" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(YAML.safe_load(written)["llm"]["presets"]["openai"]["model"]).to eq("gpt-4o")
    ensure
      keys.each { |k| prev_env[k].nil? ? ENV.delete(k) : ENV[k] = prev_env[k] }
    end
  end
end
