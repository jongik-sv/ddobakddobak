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

  describe "프롬프트 앵커 보존 (압축 회귀 가드)" do
    it "REFINE_NOTES: 최우선/⚠️/mermaid 따옴표·br·mindmap id·유니코드 보존" do
      p = LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT
      expect(p).to include("[최우선]")
      expect(p).to include("⚠️")
      expect(p).to include('A["')          # mermaid 노드 따옴표 규칙
      expect(p).to include("<br/>")        # 줄바꿈 규칙
      expect(p).to include('id["라벨"]')   # mindmap 잎 id 규칙
      expect(p).to include("g/m²")         # 유니코드 단위 예시
    end

    it "APPEND_NOTES: 새 블록/빈 문자열/mermaid 따옴표 보존" do
      p = LlmPrompts::APPEND_NOTES_SYSTEM_PROMPT
      expect(p).to include("빈 문자열")
      expect(p).to include('A["')
    end

    it "FEEDBACK_NOTES: [필수] mermaid 3규칙 보존" do
      p = LlmPrompts::FEEDBACK_NOTES_SYSTEM_PROMPT
      expect(p).to include("[필수]")
      expect(p).to include('A["라벨"]')
      expect(p).to include("<br/>")
      expect(p).to include('id["라벨"]')
    end

    it "CITATION_MARKER: 마커 토큰/화자값/최우선 보존" do
      p = LlmPrompts::CITATION_MARKER_INSTRUCTION
      expect(p).to include("⟦t:<ms>/s:<화자>⟧")
      expect(p).to include("화자값")
      expect(p).to include("[최우선]")
    end

    it "FOLDER_CHAT_CITATION: 회의ID 포함 마커 토큰 보존" do
      expect(LlmPrompts::FOLDER_CHAT_CITATION_INSTRUCTION).to include("⟦m:<회의ID>/t:<ms>/s:<화자>⟧")
    end

    it "MEETING_CHAT: 마커/화자값/FOLLOWUPS 센티넬 보존" do
      p = LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT
      expect(p).to include("⟦t:<ms>/s:<화자>⟧")
      expect(p).to include("화자값")
      expect(p).to include("<<<FOLLOWUPS>>>")
    end

    it "FOLDER_CHAT: FOLLOWUPS 센티넬 + 인용 보간 보존" do
      p = LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT
      expect(p).to include("<<<FOLLOWUPS>>>")
      expect(p).to include("⟦m:<회의ID>/t:<ms>/s:<화자>⟧")  # CITATION 보간 결과
    end

    it "EXPANSION: JSON 키/코드펜스 금지 지시 보존" do
      p = LlmPrompts::FOLDER_CHAT_EXPANSION_PROMPT
      expect(p).to include('"keywords"')
      expect(p).to include('"expansions"')
    end

    it "SUMMARIZE/ACTION_ITEMS: JSON 스키마 키 보존" do
      expect(LlmPrompts::SUMMARIZE_SYSTEM_PROMPT).to include('"key_points"')
      expect(LlmPrompts::SUMMARIZE_SYSTEM_PROMPT).to include('"action_items"')
      expect(LlmPrompts::ACTION_ITEMS_SYSTEM_PROMPT).to include('"action_items"')
    end

    it "DEFAULT_SECTION_STRUCTURE: 섹션 제목 5개 보존" do
      p = LlmPrompts::DEFAULT_SECTION_STRUCTURE
      ["## 1. 핵심 요약", "## 2. 논의 사항", "## 3. 결정사항", "## 4. Action Items", "## 5. 기타 논의"].each do |h|
        expect(p).to include(h)
      end
    end

    it "seeded_merge_instruction: 최우선 + 절취선 보간 보존" do
      dummy = Class.new { include LlmPrompts }.new
      out = dummy.seeded_merge_instruction
      expect(out).to include("[최우선]")
      expect(out).to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end
  end

  describe "챗 답변 압축 (목표 B)" do
    it "MEETING_CHAT: 체언종결 브레비티 지시 포함" do
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("명사형/체언 종결")
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("서론·맺음말")
    end
    it "FOLDER_CHAT: 체언종결 브레비티 지시 포함" do
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include("명사형/체언 종결")
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include("서론·맺음말")
    end
  end
end
