require "rails_helper"

RSpec.describe LlmProfileYamlSync do
  let!(:profile) do
    LlmProfile.create!(user_id: nil, name: "Gemini · 무료키", preset_id: "gemini", provider: "openai",
                       base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                       model: "gemini-3.5-flash", auth_token: "AIza-tok-123456789",
                       max_input_tokens: 100_000, max_output_tokens: 8_000)
  end

  it "active_profile_id를 기존 presets 구조로 실체화한다 (load_env 호환)" do
    cfg = { "llm" => { "active_profile_id" => profile.id } }
    described_class.apply!(cfg)
    llm = cfg["llm"]
    expect(llm["active_preset"]).to eq("gemini")
    expect(llm["presets"]["gemini"]).to include(
      "provider" => "openai", "auth_token" => "AIza-tok-123456789",
      "model" => "gemini-3.5-flash", "max_input_tokens" => 100_000, "max_output_tokens" => 8_000
    )
  end

  it "chat_profile_id는 llm.chat으로 실체화한다" do
    cfg = { "llm" => { "chat_profile_id" => profile.id } }
    described_class.apply!(cfg)
    expect(cfg["llm"]["chat"]).to include("preset_id" => "gemini", "provider" => "openai", "auth_token" => "AIza-tok-123456789", "model" => "gemini-3.5-flash")
  end

  it "삭제된 프로필 id는 참조 키를 제거하고 실체화 값은 남긴다" do
    cfg = { "llm" => { "active_profile_id" => 999_999, "active_preset" => "anthropic", "presets" => { "anthropic" => { "provider" => "anthropic" } } } }
    described_class.apply!(cfg)
    expect(cfg["llm"]).not_to have_key("active_profile_id")
    expect(cfg["llm"]["active_preset"]).to eq("anthropic")
  end
end
