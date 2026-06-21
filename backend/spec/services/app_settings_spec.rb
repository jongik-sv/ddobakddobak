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

    context "사용성 게이트 (no-key cloud → 요약 모델 폴백)" do
      it "클라우드 provider + auth_token 빈값 + base_url 없음 → 빈 해시 (CHAT_LLM_* 미방출)" do
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5", "auth_token" => "", "base_url" => "" } }
        expect(described_class.chat_llm_env(llm)).to eq({})
      end

      it "클라우드 provider + 토큰 없음 + localhost base_url → 방출 (로컬은 키 불요)" do
        llm = { "chat" => { "provider" => "openai", "model" => "qwen", "base_url" => "http://localhost:1234/v1" } }
        env = described_class.chat_llm_env(llm)
        expect(env["CHAT_LLM_PROVIDER"]).to eq("openai")
        expect(env["CHAT_LLM_BASE_URL"]).to eq("http://localhost:1234/v1")
      end

      it "CLI provider(gemini_cli) + 토큰 없음 → 방출 (CLI는 키 불요)" do
        llm = { "chat" => { "provider" => "gemini_cli", "model" => "Gemini 3.5 Flash (Medium)" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("gemini_cli")
      end

      it "anthropic + 토큰 있음 → 방출" do
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5", "auth_token" => "k" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("anthropic")
      end

      it "openai + 토큰 있음 → 방출" do
        llm = { "chat" => { "provider" => "openai", "model" => "gpt-4o-mini", "auth_token" => "k" } }
        expect(described_class.chat_llm_env(llm)["CHAT_LLM_PROVIDER"]).to eq("openai")
      end

      it "사용 불가(no-key cloud)면 레거시 chat_model이 있어도 그 모델을 방출하지 않는다" do
        # chat 서브해시가 사용 불가면 {} → 요약 모델 폴백.
        # (레거시 chat_model 분기는 chat.provider 가 없을 때만 동작)
        llm = { "chat" => { "provider" => "anthropic", "model" => "claude-haiku-4-5" }, "chat_model" => "opus" }
        expect(described_class.chat_llm_env(llm)).to eq({})
      end
    end
  end
end
