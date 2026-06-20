require "rails_helper"

RSpec.describe LlmModelName do
  describe ".humanize" do
    it "claude 계열을 친절명으로 변환한다" do
      expect(described_class.humanize("claude-sonnet-4-20250514")).to eq("Claude Sonnet 4")
      expect(described_class.humanize("claude-opus-4-1-20250805")).to eq("Claude Opus 4")
      expect(described_class.humanize("claude-3-5-haiku-20241022")).to eq("Claude Haiku 3")
    end

    it "gpt 계열을 친절명으로 변환한다" do
      expect(described_class.humanize("gpt-4o")).to eq("GPT-4o")
      expect(described_class.humanize("gpt-5")).to eq("GPT-5")
    end

    it "로컬/오픈모델 이름을 prettify 한다" do
      expect(described_class.humanize("llama-3.1-8b-instruct")).to eq("Llama 3.1 8b Instruct")
      expect(described_class.humanize("qwen2.5-7b")).to eq("Qwen2.5 7b")
    end

    it "이미 친절한 CLI 표시명은 그대로 둔다" do
      expect(described_class.humanize("Gemini 3.5 Flash (Medium)")).to eq("Gemini 3.5 Flash (Medium)")
    end

    it "nil/blank 는 AI 로 폴백한다" do
      expect(described_class.humanize(nil)).to eq("AI")
      expect(described_class.humanize("")).to eq("AI")
    end
  end
end
