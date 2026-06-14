require "rails_helper"

# 이전 회의 참고(증분): refine_notes(seeded_merge: true) 가 "한 회의로 통합 + 논의 절취선"
# 지시를 시스템 프롬프트에 주입하는지 검증 (실제 LLM 호출은 stub).
RSpec.describe LlmService do
  subject(:llm) { described_class.new(llm_config: { provider: "anthropic", auth_token: "x", model: "m" }) }

  let(:transcripts) { [ { "speaker" => "A", "text" => "오늘 논의 시작" } ] }

  it "injects the merge + discussion cut-line instruction when seeded_merge: true" do
    captured = nil
    allow(llm).to receive(:call_llm_raw) { |sys, _user, **| captured = sys; "## 결과" }

    llm.refine_notes("## 지난 회의", transcripts, seeded_merge: true)

    expect(captured).to include(Meeting::PREVIOUS_MEETING_CUT_LINE) # 절취선 본문 지시
    expect(captured).to include("논의") # 논의사항에 절취선
    expect(captured).to include("통합") # 핵심/결정/AI 통합
  end

  it "does NOT inject the instruction by default (재구조화·비연결)" do
    captured = nil
    allow(llm).to receive(:call_llm_raw) { |sys, _user, **| captured = sys; "## 결과" }

    llm.refine_notes("## 회의록", transcripts)

    expect(captured).not_to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
  end
end
