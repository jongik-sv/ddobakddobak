require "rails_helper"

# 이전 회의 참고: refine_notes(seeded_from_previous: true) 가 "이전 회의록 보존" 규칙을
# 시스템 프롬프트에 주입하는지 검증 (실제 LLM 호출은 stub).
RSpec.describe LlmService do
  subject(:llm) { described_class.new(llm_config: { provider: "anthropic", auth_token: "x", model: "m" }) }

  let(:transcripts) { [ { "speaker" => "A", "text" => "오늘 논의 시작" } ] }

  it "injects the seed-preservation instruction when seeded_from_previous: true" do
    captured = nil
    allow(llm).to receive(:call_llm_raw) { |sys, _user, **| captured = sys; "## 결과" }

    llm.refine_notes("## 지난 회의\n\n---\n#{Meeting::PREVIOUS_MEETING_MARKER}", transcripts, seeded_from_previous: true)

    expect(captured).to include("이전 회의록 보존")
    expect(captured).to include(Meeting::PREVIOUS_MEETING_MARKER)
  end

  it "does NOT inject the instruction by default" do
    captured = nil
    allow(llm).to receive(:call_llm_raw) { |sys, _user, **| captured = sys; "## 결과" }

    llm.refine_notes("## 회의록", transcripts)

    expect(captured).not_to include("이전 회의록 보존")
  end
end
