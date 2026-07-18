require "rails_helper"

RSpec.describe LlmProfileLegacyImporter do
  before do
    allow(File).to receive(:exist?).and_call_original
    allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
    allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump(yaml))
    allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything).and_return(true)
  end
  let(:yaml) { {} }

  describe "users 이관" do
    let(:yaml) { {} }

    it "API 설정 유저 → 프로필 생성+참조+레거시 클리어, CLI 유저는 그대로" do
      api_user = create(:user, llm_provider: "anthropic", llm_api_key: "sk-ant-123456789", llm_model: "claude-sonnet-5")
      cli_user = create(:user, llm_provider: "claude_cli", llm_model: "sonnet")
      zai_user = create(:user, llm_provider: "anthropic", llm_api_key: "zk-123456789", llm_base_url: "https://api.z.ai/api/anthropic", llm_model: "glm-5.2")

      described_class.run!

      api_user.reload
      expect(api_user.llm_profile).to be_present
      expect(api_user.llm_profile.preset_id).to eq("anthropic")
      expect(api_user.llm_profile.auth_token).to eq("sk-ant-123456789")
      expect(api_user.llm_provider).to be_nil

      expect(cli_user.reload.llm_provider).to eq("claude_cli")
      expect(cli_user.llm_profile_id).to be_nil

      expect(zai_user.reload.llm_profile.preset_id).to eq("zai")
    end

    it "챗 독립 설정도 챗 프로필로 이관, 'server' 센티넬은 보존" do
      chat_user = create(:user, chat_llm_provider: "openai", chat_llm_api_key: "sk-oa-123456789", chat_llm_model: "gpt-4o-mini")
      server_user = create(:user, chat_llm_provider: "server")

      described_class.run!

      expect(chat_user.reload.chat_llm_profile.preset_id).to eq("openai")
      expect(chat_user.chat_llm_provider).to be_nil
      expect(server_user.reload.chat_llm_provider).to eq("server")
    end

    it "동일 유저의 요약·챗이 같은 이름을 낳으면 (2) 접미로 dedup한다" do
      u = create(:user,
        llm_provider: "anthropic", llm_api_key: "k1-123456789", llm_model: "claude-x",
        chat_llm_provider: "anthropic", chat_llm_api_key: "k2-123456789", chat_llm_model: "claude-x")
      described_class.run!
      names = u.reload.llm_profiles.pluck(:name)
      expect(names).to contain_exactly("Anthropic · claude-x", "Anthropic · claude-x (2)")
    end

    it "멱등 — 두 번 실행해도 프로필이 늘지 않는다" do
      create(:user, llm_provider: "openai", llm_api_key: "sk-123456789", llm_model: "gpt-4o")
      described_class.run!
      expect { described_class.run! }.not_to change(LlmProfile, :count)
    end
  end

  describe "settings.yaml 이관" do
    let(:yaml) do
      { "llm" => {
        "active_preset" => "openai",
        "presets" => {
          "openai" => { "provider" => "openai", "auth_token" => "sk-server-123456789", "model" => "gpt-4o", "max_input_tokens" => 150_000 },
          "claude_cli" => { "provider" => "claude_cli", "model" => "sonnet" }
        },
        "chat" => { "preset_id" => "zai", "provider" => "anthropic", "auth_token" => "zk-9876543210", "base_url" => "https://api.z.ai/api/anthropic", "model" => "glm-5.2" }
      } }
    end

    it "API 프리셋만 서버 풀 프로필화, active/chat 참조 세팅, CLI 프리셋은 프로필 미생성" do
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }

      described_class.run!

      pool = LlmProfile.server_pool
      expect(pool.pluck(:preset_id)).to contain_exactly("openai", "zai")
      openai_p = pool.find_by(preset_id: "openai")
      expect(openai_p.auth_token).to eq("sk-server-123456789")
      expect(openai_p.max_input_tokens).to eq(150_000)

      cfg = YAML.safe_load(written)
      expect(cfg["llm"]["active_profile_id"]).to eq(openai_p.id)
      expect(cfg["llm"]["chat_profile_id"]).to eq(pool.find_by(preset_id: "zai").id)
      expect(cfg["llm"]["active_preset"]).to eq("openai") # 실체화 유지
    end
  end

  describe "챗이 서버 풀로 승격된 기존 API 프리셋을 참조하되 모델이 다른 경우" do
    let(:yaml) do
      { "llm" => {
        "active_preset" => "openai",
        "presets" => {
          "openai" => { "provider" => "openai", "auth_token" => "sk-server-123456789", "model" => "gpt-4o", "max_input_tokens" => 150_000 }
        },
        "chat" => { "preset_id" => "openai", "provider" => "openai", "auth_token" => "sk-server-123456789", "model" => "gpt-4o-mini" }
      } }
    end

    it "프리셋을 그대로 재사용하지 않고 챗 전용 '(챗)' 프로필을 별도 생성해 챗 모델을 보존한다" do
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }

      described_class.run!

      pool = LlmProfile.server_pool
      openai_p = pool.find_by(preset_id: "openai", name: "OpenAI")
      chat_p = pool.find_by(preset_id: "openai", name: "OpenAI (챗)")

      expect(chat_p).to be_present
      expect(chat_p.id).not_to eq(openai_p.id)
      expect(chat_p.model).to eq("gpt-4o-mini")
      expect(openai_p.model).to eq("gpt-4o") # 프리셋 프로필 자체는 그대로

      cfg = YAML.safe_load(written)
      expect(cfg["llm"]["chat_profile_id"]).to eq(chat_p.id)
      expect(cfg["llm"]["chat"]["model"]).to eq("gpt-4o-mini") # 재실체화 후에도 챗 모델 보존
    end
  end
end
