module SttTermLearning
  # 학습 run 하나에서 오인식 후보를 뽑는다.
  #   (가) AI 원본(run.ai_text) ↔ 사람 최종본(run.human_text) 줄 diff → LLM 추출 (source "llm_diff")
  #   (나) 회의 교정 사전(enabled·literal)의 from→to (source "feedback", confidence 1.0)
  # 같은 [wrong_key, correct_key] 는 하나로 합치고 source 는 feedback 으로 남긴다
  # (feedback 쌍은 전사까지 고쳐지므로 이후 전사 필터 면제를 유지해야 한다).
  # 필터·등록 판정은 하지 않는다(Task 6 몫). 빈 wrong/correct 만 버린다.
  class CandidateExtractor
    MAX_HUNKS_CHARS = 12_000
    HINT_LIMIT = 30
    DEFINITION_MAX = 60
    DEFAULT_CATEGORY = "STT".freeze

    def initialize(run)
      @run = run
      @meeting = run.meeting
    end

    # -> { candidates: [Candidate], llm_model: String|nil, llm_skipped_reason: String|nil }
    def call
      llm_model = nil
      llm_skipped_reason = nil
      llm_candidates = []

      hunks_text = build_hunks_text
      if hunks_text.present?
        begin
          llm = LlmService.new(llm_config: @meeting.creator&.effective_llm_config)
          llm_model = llm.model_name
          llm_candidates = normalize_llm(llm.extract_stt_misrecognitions(hunks_text, build_hints_text))
        rescue LlmService::NotConfiguredError
          llm_skipped_reason = "llm_not_configured"
        end
      end

      { candidates: merge(feedback_candidates, llm_candidates), llm_model: llm_model, llm_skipped_reason: llm_skipped_reason }
    end

    private

    def build_hunks_text
      hunks = LineDiff.hunks(LineDiff.ops(@run.ai_text, @run.human_text))
      return "" if hunks.empty?

      text = hunks.map do |h|
        (h[:removed].map { "- #{_1}" } + h[:added].map { "+ #{_1}" }).join("\n")
      end.join("\n\n")
      text[0, MAX_HUNKS_CHARS]
    end

    def build_hints_text
      project = @meeting.project
      return "" unless project

      confirmed = SttMisrecognition.where(project: project).confirmed.order(hit_count: :desc, id: :asc).limit(HINT_LIMIT)
      excluded = SttMisrecognition.where(project: project).excluded.order(id: :asc).limit(HINT_LIMIT)
      (confirmed.map { "확정: #{_1.wrong}→#{_1.correct}" } + excluded.map { "제외: #{_1.wrong}→#{_1.correct}" }).join("\n")
    end

    def feedback_candidates
      @meeting.glossary_entries.where(enabled: true, match_type: "literal").order(:id).filter_map do |g|
        build(wrong: g.from_text, correct: g.to_text, category: nil, definition: nil, confidence: 1.0, source: "feedback")
      end
    end

    def normalize_llm(items)
      Array(items).filter_map do |raw|
        next unless raw.is_a?(Hash)

        build(wrong: raw["wrong"], correct: raw["correct"], category: raw["category"],
              definition: raw["definition"], confidence: parse_confidence(raw["confidence"]), source: "llm_diff")
      end
    end

    def build(wrong:, correct:, category:, definition:, confidence:, source:)
      wrong = wrong.to_s.strip
      correct = correct.to_s.strip
      return nil if wrong.empty? || correct.empty?

      definition = definition.to_s.strip.presence
      Candidate.new(
        wrong: wrong,
        correct: correct,
        category: category.to_s.strip.presence || DEFAULT_CATEGORY,
        definition: definition && definition[0, DEFINITION_MAX],
        confidence: confidence,
        source: source
      )
    end

    def parse_confidence(value)
      Float(value).clamp(0.0, 1.0)
    rescue ArgumentError, TypeError
      nil
    end

    # feedback 먼저, LLM 은 뒤. 같은 key 는 첫 항목에 합친다.
    # feedback 에 LLM 이 겹치면 source·표기·confidence 는 feedback 유지, category·definition 은 LLM 값이 있으면 채택.
    def merge(feedback, llm)
      by_key = {}
      feedback.each { |c| by_key[c.key] ||= c }
      llm.each do |c|
        existing = by_key[c.key]
        if existing.nil?
          by_key[c.key] = c
        elsif existing.source == "feedback" && !existing.equal?(c)
          existing.category = c.category if c.category.present? && c.category != DEFAULT_CATEGORY
          existing.definition = c.definition if c.definition.present?
        end
      end
      by_key.values
    end
  end
end
