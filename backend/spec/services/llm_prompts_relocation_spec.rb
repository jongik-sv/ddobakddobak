# frozen_string_literal: true

require "rails_helper"
require "digest"

# llm_prompts.rb 를 6개 nested concern 으로 분할(behavior-change-0)한 뒤,
# (1) 각 상수의 바이트 동일성 — heredoc 인덴트/포맷 drift 차단,
# (2) qualified(LlmPrompts::X) + unqualified(include LlmPrompts 후 X) 양쪽 접근,
# 을 동시에 가드한다. 이동 전 원본값을 SHA256 로 떠서 박았다(손으로 옮겨 적지 않음).
RSpec.describe "LlmPrompts 분할 (behavior-change-0)" do
  # 이동 전 baseline: name => [sha256(value), bytesize]. String 상수만.
  BASELINE_SHA = {
    "SUMMARIZE_SYSTEM_PROMPT" => ["4bda7c6302a20e4a1c3d94e9edf0c8d0551d647811dc5492f81858add124ab25", 518],
    "ACTION_ITEMS_SYSTEM_PROMPT" => ["3ba066be75f5807fe6a38f4d4b22873bdadf51508ff23f01481385c99afe91de", 339],
    "DEFAULT_SECTION_STRUCTURE" => ["ab9c42efa9aa05c4e1066cb7e5c3fd17500f5942f7a2f98134d2b044aa806496", 480],
    "REFINE_NOTES_SYSTEM_PROMPT" => ["1f02a9b9926b5f344d7a41845617c3bd58c1eeb2e7ee1c5d993bc9842936028f", 5806],
    "CHRONOLOGICAL_NOTES_INSTRUCTION" => ["0d277c0663e0ad4acb93ff74051cf41caa6a8fd342ddbe52fa388592da5fc5bc", 419],
    "APPEND_NOTES_SYSTEM_PROMPT" => ["b12b3b501a1df5c88bfd0549b7cf6e257058a79a76d7bedbc74f8e5ba8f0018a", 1498],
    "FEEDBACK_NOTES_SYSTEM_PROMPT" => ["1109e13900ac3242afebff59f41488e344a2880fe21bf529c61f193733c362fe", 1648],
    "COMPRESS_AGENDA_SYSTEM_PROMPT" => ["2f5a182f91fab66712c614028079a9553da55088587634f549dfad895118481d", 505],
    "CITATION_MARKER_INSTRUCTION" => ["0c1918c05a8a563d1056494b891bae35baf67c451d16005e7b3ffd3a9ce34ccb", 1013],
    "FOLDER_CHAT_CITATION_INSTRUCTION" => ["589520d25880ece86e92a1510ad3c447ec8081b912aa9ad8d27bd997a7b734d5", 573],
    "MEETING_CHAT_SYSTEM_PROMPT" => ["ad1601cb806e9857b6fd6bcc03440fa17619916b44bcdd596a6924f86aec1aa8", 2113],
    "FOLDER_CHAT_EXPANSION_PROMPT" => ["c8a9ad72d07a4f00efcd3e113c2b81421f87334ecb800d0bfbec3e348457a5fc", 778],
    "FOLDER_CHAT_SYSTEM_PROMPT" => ["0275709dd10a494c13a3475c27f3ddd63bc6f753a328a55b5755ad18c8484f30", 1689]
  }.freeze

  describe "상수 바이트 동일성 (이동 전 == 이동 후)" do
    BASELINE_SHA.each do |name, (sha, len)|
      it "#{name} 는 분할 전과 바이트 동일하다" do
        value = LlmPrompts.const_get(name)
        expect(value).to be_a(String)
        expect(value.bytesize).to eq(len), "#{name} bytesize drift: #{value.bytesize} != #{len}"
        expect(Digest::SHA256.hexdigest(value)).to eq(sha), "#{name} 내용 drift (heredoc 인덴트/포맷 변경 의심)"
      end
    end

    it "비-문자열 설정 상수도 값이 동일하다" do
      expect(LlmPrompts::VERBOSITY_LABELS).to eq(
        "very_concise"  => "아주 간결",
        "concise"       => "간결",
        "standard"      => "보통",
        "detailed"      => "상세",
        "very_detailed" => "아주 상세"
      )
      expect(LlmPrompts::VERBOSITY_STYLES["standard"]).to be_nil
      expect(LlmPrompts::VERBOSITY_STYLES["very_detailed"]).to include("충실하게")
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:realtime, "very_detailed")).to eq(10_000)
      expect(LlmPrompts::VERBOSITY_CHAR_LIMITS.dig(:final, "very_detailed")).to eq(20_000)
    end

    it "seeded_merge_instruction(메서드)도 바이트 동일하다" do
      out = Class.new { include LlmPrompts }.new.seeded_merge_instruction
      expect(Digest::SHA256.hexdigest(out)).to eq("2ee8bc99595a92f828a69826e0a07543dd6e39ddd69e83cd18be209e8c2f400c")
      expect(out.bytesize).to eq(661)
    end
  end

  describe "cross-constant 보간 resolve" do
    it "FOLDER_CHAT_SYSTEM_PROMPT 가 FOLDER_CHAT_CITATION_INSTRUCTION 을 로드 시점에 보간한다" do
      # 다른 concern(CitationPrompts)의 상수가 ChatPrompts heredoc 안에서 풀려 들어가 있어야 함.
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include(LlmPrompts::FOLDER_CHAT_CITATION_INSTRUCTION.strip)
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include("⟦m:<회의ID>/t:<ms>/s:<화자>⟧")
    end

    it "REFINE_NOTES_SYSTEM_PROMPT 가 DEFAULT_SECTION_STRUCTURE 를 .sub 대상으로 포함한다(llm_service .sub 의 전제)" do
      expect(LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT).to include(LlmPrompts::DEFAULT_SECTION_STRUCTURE)
    end
  end

  describe "dual access: qualified + unqualified" do
    # LlmService 와 동일한 패턴(class 리터럴 본문에서 include 후, 인스턴스 메서드 안에서 unqualified 참조)을
    # 정확히 재현해야 한다. `Class.new do ... end` 블록은 Module.nesting 에 그 익명 클래스를 넣지 않아
    # 메서드 본문의 unqualified 상수가 ancestor chain 으로 풀리지 않는다(LlmService 와 다른 동작) — 사용 금지.
    # 아래 named class 리터럴은 LlmService(`class LlmService; include LlmPrompts; def …; REFINE_NOTES_…; end`)와 동일 경로.
    # 전역 상수 누출을 막기 위해 전용 모듈로 감싼다(class 키워드는 유지 — 상수 resolve 경로 보존).
    module RelocationSpecScope
      class Consumer
        include LlmPrompts
        def refine = REFINE_NOTES_SYSTEM_PROMPT
        def section = DEFAULT_SECTION_STRUCTURE
        def summarize = SUMMARIZE_SYSTEM_PROMPT
        def citation = CITATION_MARKER_INSTRUCTION
        def verbosity = VERBOSITY_CHAR_LIMITS
        def merge = seeded_merge_instruction
      end
    end

    it "include 한 클래스에서 unqualified 로 모든 핵심 상수가 resolve 된다(LlmService 패턴)" do
      c = RelocationSpecScope::Consumer.new
      expect(c.refine).to eq(LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT)
      expect(c.section).to eq(LlmPrompts::DEFAULT_SECTION_STRUCTURE)
      expect(c.summarize).to eq(LlmPrompts::SUMMARIZE_SYSTEM_PROMPT)
      expect(c.citation).to eq(LlmPrompts::CITATION_MARKER_INSTRUCTION)
      expect(c.verbosity).to eq(LlmPrompts::VERBOSITY_CHAR_LIMITS)
      expect(c.merge).to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end

    it "외부에서 qualified(LlmPrompts::X) 로도 모든 상수가 resolve 된다" do
      BASELINE_SHA.each_key do |name|
        expect { LlmPrompts.const_get(name) }.not_to raise_error
      end
      # 외부 caller 가 실제 쓰는 qualified 경로 (folder_chat_query_expansion 등)
      expect(LlmPrompts::FOLDER_CHAT_EXPANSION_PROMPT).to be_a(String)
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to be_a(String)
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to be_a(String)
    end

    it "실제 LlmService 의 ancestors 에 nested concern 들이 들어가 있다(include 경유)" do
      expect(LlmService.ancestors).to include(
        LlmPrompts::NotesPrompts,
        LlmPrompts::SummarizationPrompts,
        LlmPrompts::CompressionConfig,
        LlmPrompts::CitationPrompts,
        LlmPrompts::ChatPrompts,
        LlmPrompts::AgendaPrompts
      )
    end
  end
end
