require "rails_helper"

# 이해관계자 정보(참고용) 주입: refine_notes/append_notes/build_prompt 에 stakeholder_reference 를
# 넘기면 LLM user_content 에 "이해관계자 정보(참고용...)" 블록이 들어간다. nil 이면 블록이 없다.
# llm_service_agenda_spec.rb 미러.
RSpec.describe LlmService, "stakeholder_reference injection" do
  subject(:service) { described_class.new }

  let(:transcripts) { [ { "speaker" => "A", "text" => "오늘 일정 논의" } ] }

  def captured_user_content_refine(stakeholder_reference:)
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "## 결과"
    end
    service.refine_notes("기존", transcripts, stakeholder_reference: stakeholder_reference)
    captured
  end

  def captured_user_content_append(stakeholder_reference:)
    captured = nil
    allow(service).to receive(:call_llm_raw) do |_system, user_content, **|
      captured = user_content
      "## 블록"
    end
    service.append_notes("기존", transcripts, stakeholder_reference: stakeholder_reference)
    captured
  end

  describe "#refine_notes" do
    it "injects a stakeholder reference block when present" do
      content = captured_user_content_refine(stakeholder_reference: "김철수 / 기획팀 / 팀장")
      expect(content).to include("이해관계자 정보(참고용")
      expect(content).to include("김철수 / 기획팀 / 팀장")
    end

    it "omits the block when stakeholder_reference is nil" do
      content = captured_user_content_refine(stakeholder_reference: nil)
      expect(content).not_to include("이해관계자 정보(참고용")
    end
  end

  describe "#append_notes" do
    it "injects a stakeholder reference block when present" do
      content = captured_user_content_append(stakeholder_reference: "이해관계자: 박영희 / 개발팀")
      expect(content).to include("이해관계자 정보(참고용")
      expect(content).to include("박영희 / 개발팀")
    end

    it "omits the block when nil" do
      expect(captured_user_content_append(stakeholder_reference: nil)).not_to include("이해관계자 정보(참고용")
    end
  end

  describe "#build_prompt" do
    it "includes the stakeholder reference block in the exported prompt" do
      result = service.build_prompt("기존", transcripts, stakeholder_reference: "이해관계자: 최지훈")
      expect(result["prompt"]).to include("이해관계자 정보(참고용")
      expect(result["prompt"]).to include("최지훈")
    end

    it "omits the block when nil" do
      result = service.build_prompt("기존", transcripts, stakeholder_reference: nil)
      expect(result["prompt"]).not_to include("이해관계자 정보(참고용")
    end
  end
end
