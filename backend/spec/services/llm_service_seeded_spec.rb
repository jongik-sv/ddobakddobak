require "rails_helper"

# 연결 회의 상단 고정 요약 관련 LlmService 계약:
# - #condense_previous_notes: 이전 회의 본문을 압축(Meeting#seed_summary_from_previous! 가 호출).
# - #refine_notes/#append_notes 의 pinned_context: 절취선 위(상단 고정 블록)를 참고용으로만 주입,
#   current_notes(재작성 대상)에는 포함하지 않는다.
# 실제 LLM 호출은 전부 stub.
RSpec.describe LlmService do
  subject(:llm) { described_class.new(llm_config: { provider: "anthropic", auth_token: "x", model: "m" }) }

  let(:transcripts) { [ { "speaker" => "A", "text" => "오늘 논의 시작" } ] }

  describe "#condense_previous_notes" do
    it "이전 회의 본문을 압축 프롬프트로 호출해 압축된 마크다운을 반환한다" do
      captured = {}
      allow(llm).to receive(:call_llm_raw) { |sys, user, **| captured[:sys] = sys; captured[:user] = user; "- 결정: A안" }

      result = llm.condense_previous_notes("## 지난 회의\n- 결정: A안 채택", meeting_title: "지난 회의")

      expect(result).to eq("- 결정: A안")
      expect(captured[:sys]).to include(LlmPrompts::CONDENSE_PREVIOUS_NOTES_SYSTEM_PROMPT)
      expect(captured[:user]).to include("지난 회의")
      expect(captured[:user]).to include("결정: A안 채택")
    end

    it "LLM 출력에 마커가 섞여 나와도 코드 레벨로 전부 제거한다(블록 헤더가 이미 출처 표시)" do
      allow(llm).to receive(:call_llm_raw)
        .and_return("- 결정: A안 채택 ⟦t:1000/s:화자 1⟧\n- 예산 승인 ⟦m:7/t:2000/s:화자 2⟧")

      result = llm.condense_previous_notes("본문", meeting_title: "지난 회의")

      expect(result).not_to include("⟦")
      expect(result).to include("결정: A안 채택")
      expect(result).to include("예산 승인")
    end

    it "빈 입력이면 LLM 을 호출하지 않고 nil 을 반환한다" do
      expect(llm).not_to receive(:call_llm_raw)
      expect(llm.condense_previous_notes("   ")).to be_nil
      expect(llm.condense_previous_notes(nil)).to be_nil
    end

    it "LLM 호출 실패 시 nil 을 반환한다(호출부가 원문 폴백 — 폴백 경로는 마커 각인을 유지한다)" do
      allow(llm).to receive(:call_llm_raw).and_raise(LlmService::LlmError, "boom")
      expect(llm.condense_previous_notes("본문")).to be_nil
    end

    it "출력이 빈 문자열이면 nil 로 정규화한다" do
      allow(llm).to receive(:call_llm_raw).and_return("")
      expect(llm.condense_previous_notes("본문")).to be_nil
    end

    it "출력이 마커만으로 이뤄져 제거 후 빈 문자열이면 nil 로 정규화한다" do
      allow(llm).to receive(:call_llm_raw).and_return("⟦t:1000/s:화자 1⟧")
      expect(llm.condense_previous_notes("본문")).to be_nil
    end
  end

  describe "pinned_context (연결 회의 상단 고정 블록 참고 주입)" do
    it "refine_notes: pinned_context 가 있으면 참고용 블록으로 user_content 에 주입하고 current_notes 에는 섞지 않는다" do
      captured_user = nil
      allow(llm).to receive(:call_llm_raw) { |_sys, user, **| captured_user = user; "## 결과" }

      llm.refine_notes("현재 본문", transcripts, pinned_context: "## 이전 회의 요약\n\n### A\n압축A")

      expect(captured_user).to include("이전 회의 요약(참고용 — 수정·재출력 금지):")
      expect(captured_user).to include("압축A")
      expect(captured_user).to include("현재 회의록:\n현재 본문")
    end

    it "refine_notes: pinned_context 없으면 참고 블록을 주입하지 않는다" do
      captured_user = nil
      allow(llm).to receive(:call_llm_raw) { |_sys, user, **| captured_user = user; "## 결과" }

      llm.refine_notes("현재 본문", transcripts)

      expect(captured_user).not_to include("이전 회의 요약(참고용")
    end

    it "append_notes: pinned_context 가 있으면 참고용 블록으로 주입한다" do
      captured_user = nil
      allow(llm).to receive(:call_llm_raw) { |_sys, user, **| captured_user = user; "새 블록" }

      llm.append_notes("현재 본문", transcripts, pinned_context: "## 이전 회의 요약\n\n### A\n압축A")

      expect(captured_user).to include("이전 회의 요약(참고용 — 수정·재출력 금지):")
      expect(captured_user).to include("압축A")
    end
  end
end
