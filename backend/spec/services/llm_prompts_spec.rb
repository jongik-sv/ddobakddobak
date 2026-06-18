# frozen_string_literal: true

require "rails_helper"

RSpec.describe LlmPrompts do
  describe "MEETING_CHAT_SYSTEM_PROMPT" do
    it "챗 프롬프트에 마커 형식 지침이 있다" do
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("⟦t:")
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("화자 N")
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
end
