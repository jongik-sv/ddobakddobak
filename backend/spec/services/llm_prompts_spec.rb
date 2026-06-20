# frozen_string_literal: true

require "rails_helper"

RSpec.describe LlmPrompts do
  describe "MEETING_CHAT_SYSTEM_PROMPT" do
    it "챗 프롬프트에 마커 형식 지침이 있다" do
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("⟦t:<ms>/s:<화자>⟧")
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("화자값")
    end

    it "FOLLOWUPS 센티넬 지시를 포함한다" do
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("<<<FOLLOWUPS>>>")
    end
  end

  describe "CITATION_MARKER_INSTRUCTION" do
    it "freeze가 적용돼 있다" do
      expect(LlmPrompts::CITATION_MARKER_INSTRUCTION).to be_frozen
    end
  end

  describe "VERBOSITY_CHAR_LIMITS very_detailed 유한 캡" do
    it "final very_detailed 캡이 20,000자다(타임아웃 방지)" do
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:final, "very_detailed")).to eq(20_000)
    end

    it "realtime very_detailed 캡이 10,000자다" do
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:realtime, "very_detailed")).to eq(10_000)
    end

    it "기존 detailed/standard 값은 불변이다" do
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:final, "detailed")).to eq(15_000)
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:final, "standard")).to eq(10_000)
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:realtime, "detailed")).to eq(8_000)
    end
  end

  describe "VERBOSITY_STYLES very_detailed" do
    it "'분량 제한 없이' 표현이 캡과 모순되지 않게 제거됐다" do
      expect(LlmPrompts::VERBOSITY_STYLES["very_detailed"]).not_to include("분량 제한 없이")
      expect(LlmPrompts::VERBOSITY_STYLES["very_detailed"]).to include("충실하게")
    end
  end
end
