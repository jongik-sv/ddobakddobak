# frozen_string_literal: true

require "rails_helper"
require "digest"

# llm_prompts.rb 를 6개 nested concern 으로 분할(behavior-change-0)한 뒤,
# (1) 각 상수의 바이트 동일성 — heredoc 인덴트/포맷 drift 차단,
# (2) qualified(LlmPrompts::X) + unqualified(include LlmPrompts 후 X) 양쪽 접근,
# 을 동시에 가드한다. 이동 전 원본값을 SHA256 로 떠서 박았다(손으로 옮겨 적지 않음).
#
# MEETING_CHAT_SYSTEM_PROMPT·FOLDER_CHAT_SYSTEM_PROMPT 는 idea.md 30-① (AI 챗 mermaid 백엔드 활성화)
# 에서 MermaidPrompts::CHAT_DIAGRAM_INSTRUCTION 보간이 추가되어 내용이 의도적으로 변경됐다.
# REFINE_NOTES_SYSTEM_PROMPT·FEEDBACK_NOTES_SYSTEM_PROMPT 는 요약 프롬프트 다이어트(mermaid 규칙
# 중복 제거·유니코드 수식 표기 공용화·문체 압축, DIAGRAM_INSTRUCTION/MERMAID_SYNTAX_RULES 도입)로
# 내용이 의도적으로 변경됐다 — baseline 갱신. APPEND_NOTES_SYSTEM_PROMPT 는 실시간 틱 경로라 원문을
# 그대로 유지했으므로 baseline 불변.
# CITATION_MARKER_INSTRUCTION 은 두 변경이 겹쳐 내용이 의도적으로 바뀌었다 — baseline 갱신.
# (1) 연결 회의 시드 마커 각인(⟦m:<id>/t:..⟧) 도입에 맞춰 "[최우선] 보존" 지시에 ⟦m:..⟧ 도 명시.
# (2) 인용 마커 정규화 패스 도입(LlmService 출력에 CitationMarkers.normalize 적용)에 맞춰
#     "마커는 원형 그대로 복사" 지시 1줄 추가. 두 변경 합산 1013→1145바이트.
# REFINE_NOTES_SYSTEM_PROMPT·APPEND_NOTES_SYSTEM_PROMPT 는 물결(~) 범위 표기가 마크다운
# 취소선(~~)으로 오인되는 문제 방지 — "범위는 하이픈(-) 표기" 규칙 1줄씩 추가로 내용이
# 의도적으로 바뀌었다 — baseline 갱신 (REFINE 3745→3947, APPEND 1498→1680바이트).
#
# 실서버 챗 마커 하드닝(2026-09): 회의 챗(MEETING_CHAT_SYSTEM_PROMPT)이 CITATION_MARKER_
# INSTRUCTION 을 쓰지 않고 자기 인라인 축약본을 쓰고, 폴더 챗(FOLDER_CHAT_CITATION_INSTRUCTION)도
# 또 다른 사본을 써서 "단위 접미사 금지" 등 하드닝 규칙이 세 프롬프트 중 한 곳에만 있던 게
# 실서버 챗 마커 106건 방치의 원인 중 하나였다. CitationPrompts::CITATION_MARKER_HARDENING
# 상수를 신설해 세 프롬프트가 보간하도록 통합했다(신설 상수라 BASELINE_SHA 대상 아님, 문자열
# drift는 그 상수를 보간하는 4개 상수의 바이트 변경으로 간접 검증됨). 중복 제거를 위해
# CITATION_MARKER_INSTRUCTION 의 "마커는 원형 그대로 복사한다 — ms 등 단위 추가..." 줄에서
# 단위 추가 금지 부분을 HARDENING 으로 넘기고 "'~' 범위 병합... 금지"만 남겨 [최우선] 보존
# 지시 문장에 합쳤다. 세 상수의 "불명확하면 (마커) 생략" 문구도 HARDENING 의 "값이 불확실하면
# 마커 자체를 쓰지 않는다"와 중복이라 제거했다. FOLDER_CHAT_CITATION_INSTRUCTION 에는 폴더 챗
# 전용 규칙("회의ID만 있고 시간·화자가 빠진 마커 금지")도 추가됐다.
# baseline 갱신: CITATION_MARKER_INSTRUCTION 1145→1403, FOLDER_CHAT_CITATION_INSTRUCTION
# 573→1006, MEETING_CHAT_SYSTEM_PROMPT 4498→4797, FOLDER_CHAT_SYSTEM_PROMPT 4074→4507바이트
# (뒤 둘은 위 두 상수를 보간하므로 연쇄 변경). 4개 값 전부 RAILS_ENV=test bundle exec rails
# runner 로 LlmPrompts 상수에서 직접 재계산했다(손으로 옮겨 적지 않음).
RSpec.describe "LlmPrompts 분할 (behavior-change-0)" do
  # 이동 전 baseline: name => [sha256(value), bytesize]. String 상수만.
  BASELINE_SHA = {
    "DEFAULT_SECTION_STRUCTURE" => ["ab9c42efa9aa05c4e1066cb7e5c3fd17500f5942f7a2f98134d2b044aa806496", 480],
    "REFINE_NOTES_SYSTEM_PROMPT" => ["36c4f81df3f3ba1773f322d7c933c19a33265e60b71c0d12698ed6a21031cdb7", 3947],
    "CHRONOLOGICAL_NOTES_INSTRUCTION" => ["0d277c0663e0ad4acb93ff74051cf41caa6a8fd342ddbe52fa388592da5fc5bc", 419],
    "APPEND_NOTES_SYSTEM_PROMPT" => ["dc748ec42389aa7f89982c1cdbf2c76407d16eca28f524edb311dcb55f32f2da", 1680],
    "COMPRESS_AGENDA_SYSTEM_PROMPT" => ["2f5a182f91fab66712c614028079a9553da55088587634f549dfad895118481d", 505],
    "CITATION_MARKER_INSTRUCTION" => ["1b70f39c473b8d34155cf492dccb02f6a0e2c427a170c24632d876bd422cbfc4", 1403],
    "FOLDER_CHAT_CITATION_INSTRUCTION" => ["b00d99f6ed2bea2c7cfed57a0ec73e28a1b9db5156372c1aaa81f581e14dee29", 1006],
    "MEETING_CHAT_SYSTEM_PROMPT" => ["9f6e8ea97f8b5a9343a0517b024b1e35e2eef79916a300289f640b125e9fbea1", 4797],
    "FOLDER_CHAT_EXPANSION_PROMPT" => ["c8a9ad72d07a4f00efcd3e113c2b81421f87334ecb800d0bfbec3e348457a5fc", 778],
    "FOLDER_CHAT_SYSTEM_PROMPT" => ["3c9efcab2fa130502200e2caffdb36a91829b92c5848d8b19094dd7a31fc7474", 4507]
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

    # 실서버 챗 마커 하드닝(2026-09)의 핵심 의도 — "세 프롬프트가 규칙을 공유한다" — 는
    # BASELINE_SHA 바이트 스냅샷만으로는 보장되지 않는다(예: 누군가 나중에 HARDENING 보간 줄을
    # 지우고 baseline만 재계산하면 바이트 동일성 검사는 통과해버린다). 공유 관계 자체를 직접 단언.
    it "세 프롬프트(회의 요약/회의 챗/폴더 챗)가 CITATION_MARKER_HARDENING 을 공유 보간한다" do
      hardening = LlmPrompts::CitationPrompts::CITATION_MARKER_HARDENING.strip
      expect(LlmPrompts::CITATION_MARKER_INSTRUCTION).to include(hardening)
      expect(LlmPrompts::FOLDER_CHAT_CITATION_INSTRUCTION).to include(hardening)
      expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include(hardening)
      # FOLDER_CHAT_SYSTEM_PROMPT 는 FOLDER_CHAT_CITATION_INSTRUCTION 을 보간해 간접 포함.
      expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include(hardening)
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
        def citation = CITATION_MARKER_INSTRUCTION
        def verbosity = VERBOSITY_CHAR_LIMITS
      end
    end

    it "include 한 클래스에서 unqualified 로 모든 핵심 상수가 resolve 된다(LlmService 패턴)" do
      c = RelocationSpecScope::Consumer.new
      expect(c.refine).to eq(LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT)
      expect(c.section).to eq(LlmPrompts::DEFAULT_SECTION_STRUCTURE)
      expect(c.citation).to eq(LlmPrompts::CITATION_MARKER_INSTRUCTION)
      expect(c.verbosity).to eq(LlmPrompts::VERBOSITY_CHAR_LIMITS)
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
