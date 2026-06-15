require "rails_helper"

# 안건 자료(참고용) 주입: refine_notes/append_notes/build_prompt 에 agenda_reference 를 넘기면
# LLM user_content 에 "안건 자료(참고용...)" 블록이 들어간다. nil 이면 블록이 없다.
RSpec.describe LlmService, "agenda_reference injection" do
  subject(:service) { described_class.new }

  let(:transcripts) { [ { "speaker" => "A", "text" => "오늘 일정 논의" } ] }

  def captured_user_content_refine(agenda_reference:)
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "## 결과"
    end
    service.refine_notes("기존", transcripts, agenda_reference: agenda_reference)
    captured
  end

  def captured_user_content_append(agenda_reference:)
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "## 블록"
    end
    service.append_notes("기존", transcripts, agenda_reference: agenda_reference)
    captured
  end

  describe "#refine_notes" do
    it "injects an agenda reference block when present" do
      content = captured_user_content_refine(agenda_reference: "1. 예산안 검토\n2. 일정 확정")
      expect(content).to include("안건 자료(참고용")
      expect(content).to include("1. 예산안 검토")
    end

    it "omits the block when agenda_reference is nil" do
      content = captured_user_content_refine(agenda_reference: nil)
      expect(content).not_to include("안건 자료(참고용")
    end
  end

  describe "#append_notes" do
    it "injects an agenda reference block when present" do
      content = captured_user_content_append(agenda_reference: "안건: 신규 채용")
      expect(content).to include("안건 자료(참고용")
      expect(content).to include("신규 채용")
    end

    it "omits the block when nil" do
      expect(captured_user_content_append(agenda_reference: nil)).not_to include("안건 자료(참고용")
    end
  end

  describe "#build_prompt" do
    it "includes the agenda reference block in the exported prompt" do
      result = service.build_prompt("기존", transcripts, agenda_reference: "안건: 로드맵")
      expect(result["prompt"]).to include("안건 자료(참고용")
      expect(result["prompt"]).to include("로드맵")
    end

    it "omits the block when nil" do
      result = service.build_prompt("기존", transcripts, agenda_reference: nil)
      expect(result["prompt"]).not_to include("안건 자료(참고용")
    end
  end
end
