require "rails_helper"

# refine_notes ok 시그널 (D8 anchor-C1): rescue 시 ok:false → 호출부가 transcript 미소비(무음 손실 차단)
RSpec.describe LlmService, "ok signalling" do
  subject(:service) { described_class.new }

  describe "#refine_notes ok flag (D8 anchor-C1)" do
    it "returns ok:true on success" do
      allow(service).to receive(:call_llm_raw).and_return("## 핵심 요약\n- 내용")
      result = service.refine_notes("기존", [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be true
      expect(result["notes_markdown"]).to include("내용")
    end

    it "returns ok:false and unchanged notes when the LLM raises" do
      allow(service).to receive(:call_llm_raw).and_raise(StandardError.new("boom"))
      result = service.refine_notes("기존 회의록", [{ "speaker" => "A", "text" => "새 내용" }])
      expect(result["ok"]).to be false
      expect(result["notes_markdown"]).to eq("기존 회의록")
    end
  end
end
