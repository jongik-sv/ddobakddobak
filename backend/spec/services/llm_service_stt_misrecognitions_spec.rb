require "rails_helper"

RSpec.describe LlmService do
  let(:svc) { LlmService.new(llm_config: { provider: "openai", model: "test-model", base_url: "http://localhost:11434/v1" }) }

  describe "#model_name" do
    it "설정의 model 을 반환한다" do
      expect(svc.model_name).to eq("test-model")
    end
  end

  describe "#extract_stt_misrecognitions" do
    it "STT 학습 SYSTEM_PROMPT 와 hunk·힌트를 넣어 call_llm_json 을 호출하고 배열을 반환한다" do
      result = [ { "wrong" => "우판", "correct" => "후판" } ]
      expect(svc).to receive(:call_llm_json) do |system, user_content|
        expect(system).to eq(LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT)
        expect(user_content).to include("- 우판 압연", "+ 후판 압연", "확정: 씨지엘→CGL")
        result
      end
      expect(svc.extract_stt_misrecognitions("- 우판 압연\n+ 후판 압연", "확정: 씨지엘→CGL")).to eq(result)
    end

    it "힌트가 비어 있으면 힌트 섹션 없이 호출한다" do
      expect(svc).to receive(:call_llm_json) do |_system, user_content|
        expect(user_content).not_to include("참고")
        []
      end
      expect(svc.extract_stt_misrecognitions("- a\n+ b", "")).to eq([])
    end

    it "배열이 아니면 nil" do
      allow(svc).to receive(:call_llm_json).and_return({ "wrong" => "우판" })
      expect(svc.extract_stt_misrecognitions("- a\n+ b", "")).to be_nil
    end

    it "예외는 nil + 로그" do
      allow(svc).to receive(:call_llm_json).and_raise(StandardError, "boom")
      expect(Rails.logger).to receive(:error).with(/extract_stt_misrecognitions failed: boom/)
      expect(svc.extract_stt_misrecognitions("- a\n+ b", "")).to be_nil
    end
  end

  describe "LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT" do
    it "JSON 배열 출력 키와 규칙을 담는다" do
      prompt = LlmPrompts::SttTermLearningPrompts::SYSTEM_PROMPT
      %w[wrong correct category definition confidence].each { |k| expect(prompt).to include(%("#{k}")) }
      expect(prompt).to include("60자", "[]")
    end
  end
end
