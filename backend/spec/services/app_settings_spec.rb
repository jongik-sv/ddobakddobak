require "rails_helper"

RSpec.describe AppSettings do
  let(:yaml) do
    <<~YAML
      diarization:
        enabled: true
        similarity_threshold: 0.5
        merge_threshold: 0.62
        max_embeddings_per_speaker: 12
    YAML
  end

  it "settings.yaml의 diarization 블록을 sidecar diarization_config로 변환한다" do
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml)
    config = described_class.diarization_config
    expect(config).to eq(
      "enable" => true,
      "ahc_threshold" => 0.3,
      "clustering_threshold" => 0.6,
      "similarity_threshold" => 0.5,
      "merge_threshold" => 0.62,
      "max_embeddings_per_speaker" => 12
    )
  end

  it "파일이 없으면 기본값(비활성)을 반환한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["enable"]).to eq(false)
  end

  it "clustering_threshold 기본값 0.6을 포함한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.6)
  end

  it "settings.yaml에 clustering_threshold가 있으면 그 값을 반환한다" do
    yaml_with_threshold = <<~YAML
      diarization:
        enabled: true
        clustering_threshold: 0.55
    YAML
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml_with_threshold)
    expect(described_class.diarization_config["clustering_threshold"]).to eq(0.55)
  end

  describe ".chat_llm_env" do
    it "llm.chat 독립 설정을 CHAT_LLM_* ENV 페어로 변환한다 (base_url 빈값은 생략)" do
      llm = {
        "chat" => {
          "provider" => "anthropic",
          "model" => "claude-haiku-4-5",
          "auth_token" => "x",
          "base_url" => ""
        }
      }
      expect(described_class.chat_llm_env(llm)).to eq(
        "CHAT_LLM_PROVIDER" => "anthropic",
        "CHAT_LLM_AUTH_TOKEN" => "x",
        "CHAT_LLM_MODEL" => "claude-haiku-4-5"
      )
    end

    it "base_url이 있으면 CHAT_LLM_BASE_URL도 포함한다" do
      llm = { "chat" => { "provider" => "anthropic", "model" => "m", "auth_token" => "x", "base_url" => "https://api.z.ai/api/anthropic" } }
      expect(described_class.chat_llm_env(llm)["CHAT_LLM_BASE_URL"]).to eq("https://api.z.ai/api/anthropic")
    end

    it "chat 독립 설정이 없고 레거시 chat_model만 있으면 CHAT_LLM_MODEL만 반환한다" do
      llm = { "chat_model" => "sonnet" }
      expect(described_class.chat_llm_env(llm)).to eq("CHAT_LLM_MODEL" => "sonnet")
    end

    it "chat provider도 chat_model도 없으면 빈 해시를 반환한다" do
      expect(described_class.chat_llm_env({})).to eq({})
      expect(described_class.chat_llm_env(nil)).to eq({})
    end
  end
end
