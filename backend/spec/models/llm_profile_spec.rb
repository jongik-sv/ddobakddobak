require "rails_helper"

RSpec.describe LlmProfile, type: :model do
  let(:user) { create(:user) }

  it "이름·프리셋·프로바이더 필수, provider는 anthropic/openai만" do
    p = LlmProfile.new(user: user, name: "", preset_id: "", provider: "claude_cli")
    expect(p).not_to be_valid
    expect(p.errors[:name]).to be_present
    expect(p.errors[:preset_id]).to be_present
    expect(p.errors[:provider]).to be_present
  end

  it "(user_id, name) 유니크 — 같은 유저 중복 이름 거부, 다른 유저는 허용" do
    LlmProfile.create!(user: user, name: "A", preset_id: "openai", provider: "openai")
    dup = LlmProfile.new(user: user, name: "A", preset_id: "anthropic", provider: "anthropic")
    expect(dup).not_to be_valid
    other = LlmProfile.new(user: create(:user), name: "A", preset_id: "openai", provider: "openai")
    expect(other).to be_valid
  end

  it "auth_token은 암호화 저장된다" do
    p = LlmProfile.create!(user: user, name: "K", preset_id: "openai", provider: "openai", auth_token: "sk-secret-1234567890")
    raw = LlmProfile.connection.select_value("SELECT auth_token FROM llm_profiles WHERE id = #{p.id}")
    expect(raw).not_to include("sk-secret")
    expect(p.reload.auth_token).to eq("sk-secret-1234567890")
  end

  it "scope: server_pool은 user_id nil만, personal_for는 해당 유저만" do
    server = LlmProfile.create!(user_id: nil, name: "S", preset_id: "anthropic", provider: "anthropic")
    mine = LlmProfile.create!(user: user, name: "M", preset_id: "openai", provider: "openai")
    expect(LlmProfile.server_pool).to contain_exactly(server)
    expect(LlmProfile.personal_for(user)).to contain_exactly(mine)
  end

  it "to_llm_config는 nil 필드를 제거해 LlmService 호환 해시를 만든다" do
    p = LlmProfile.new(name: "G", preset_id: "gemini", provider: "openai",
                       base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                       model: "gemini-3.5-flash", auth_token: "AIza-x")
    expect(p.to_llm_config).to eq(
      provider: "openai", auth_token: "AIza-x", model: "gemini-3.5-flash",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai"
    )
    expect(LlmProfile.new(name: "O", preset_id: "ollama", provider: "openai", model: "m").to_llm_config)
      .to eq(provider: "openai", model: "m")
  end

  it "삭제 시 이 프로필을 참조하는 유저 컬럼을 nullify한다" do
    p = LlmProfile.create!(user: user, name: "P", preset_id: "openai", provider: "openai")
    user.update!(llm_profile_id: p.id, chat_llm_profile_id: p.id)
    p.destroy!
    user.reload
    expect(user.llm_profile_id).to be_nil
    expect(user.chat_llm_profile_id).to be_nil
  end

  it "유저 삭제 시 개인 프로필도 함께 삭제된다 (FK constraint 500 방지 — faf79d61 계열 버그 재발 금지)" do
    p = LlmProfile.create!(user: user, name: "P", preset_id: "openai", provider: "openai")
    server = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
    expect { user.destroy! }.not_to raise_error
    expect(LlmProfile.exists?(p.id)).to be false
    expect(LlmProfile.exists?(server.id)).to be true
  end

  describe ".preset_id_for (TS presetIdFromUserConfig 미러)" do
    it "매핑 표" do
      expect(described_class.preset_id_for("anthropic", nil)).to eq("anthropic")
      expect(described_class.preset_id_for("anthropic", "https://api.z.ai/api/anthropic")).to eq("zai")
      expect(described_class.preset_id_for("openai", nil)).to eq("openai")
      expect(described_class.preset_id_for("openai", "http://localhost:11434/v1")).to eq("ollama")
      expect(described_class.preset_id_for("openai", "http://localhost:1234/v1")).to eq("lmstudio")
      expect(described_class.preset_id_for("openai", "https://generativelanguage.googleapis.com/v1beta/openai")).to eq("gemini")
      expect(described_class.preset_id_for("openai", "https://my.proxy/v1")).to eq("custom")
    end
  end
end
