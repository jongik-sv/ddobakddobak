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
    LLM_ITEMS_MAX = 100
    DEFINITION_MAX = 60
    CATEGORY_MAX = 30
    DEFAULT_CATEGORY = "STT".freeze
    HUNK_SEPARATOR = "\n\n".freeze

    def initialize(run)
      @run = run
      @meeting = run.meeting
    end

    # -> { candidates: [Candidate], llm_model: String|nil, llm_skipped_reason: String|nil }
    # llm_skipped_reason: "llm_not_configured" | "llm_failed" | nil
    #   (diff 가 없어 LLM 을 부르지 않은 경우와 LLM 이 [] 를 낸 경우는 nil)
    def call
      llm_model = nil
      llm_skipped_reason = nil
      llm_candidates = []

      hunks = LineDiff.hunks(LineDiff.ops(@run.ai_text, @run.human_text))
      hunks_text = build_hunks_text(hunks)
      if hunks.any? && hunks_text.empty?
        Rails.logger.warn "[SttTermLearning::CandidateExtractor] run=#{@run.id} hunk #{hunks.size}개가 모두 MAX_HUNKS_CHARS(#{MAX_HUNKS_CHARS}) 예산을 넘어 LLM 추출을 건너뜀"
        llm_skipped_reason = "llm_failed"
      elsif hunks_text.present?
        begin
          llm = LlmService.new(llm_config: @meeting.creator&.effective_llm_config)
          items = llm.extract_stt_misrecognitions(hunks_text, build_hints_text)
          # 호출 중 CLI 폴백으로 @config 가 바뀔 수 있어 모델명은 호출 뒤에 읽는다.
          llm_model = llm.model_name
          if items.nil?
            llm_skipped_reason = "llm_failed"
          else
            llm_candidates = normalize_llm(items)
          end
        rescue LlmService::NotConfiguredError
          llm_skipped_reason = "llm_not_configured"
        rescue => e
          Rails.logger.error "[SttTermLearning::CandidateExtractor] run=#{@run.id} LLM 실패: #{e.class}: #{e.message}"
          llm_skipped_reason = "llm_failed"
        end
      end

      { candidates: merge(feedback_candidates, llm_candidates), llm_model: llm_model, llm_skipped_reason: llm_skipped_reason }
    end

    private

    # hunk 를 통째로 MAX_HUNKS_CHARS 안에 담는다. 줄 중간에서 자르지 않고, 남은 예산에
    # 안 들어가는 hunk 는 건너뛴다(큰 hunk 하나가 뒤의 작은 hunk 를 다 버리지 않게).
    # 전부 안 들어가면 빈 문자열.
    def build_hunks_text(hunks)
      text = +""
      hunks.each do |h|
        block = (h[:removed].map { "- #{_1}" } + h[:added].map { "+ #{_1}" }).join("\n")
        addition = text.empty? ? block : HUNK_SEPARATOR + block
        next if text.length + addition.length > MAX_HUNKS_CHARS
        text << addition
      end
      text
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
      Array(items).first(LLM_ITEMS_MAX).filter_map do |raw|
        next unless raw.is_a?(Hash)
        next unless raw["wrong"].is_a?(String) && raw["correct"].is_a?(String)

        build(wrong: raw["wrong"], correct: raw["correct"], category: raw["category"],
              definition: raw["definition"], confidence: parse_confidence(raw["confidence"]), source: "llm_diff")
      end
    end

    def build(wrong:, correct:, category:, definition:, confidence:, source:)
      wrong = wrong.to_s.strip
      correct = correct.to_s.strip
      return nil if wrong.empty? || correct.empty?

      definition = definition.is_a?(String) ? definition.strip.presence : nil
      category = category.is_a?(String) ? category.strip.presence : nil
      Candidate.new(
        wrong: wrong,
        correct: correct,
        category: category ? category[0, CATEGORY_MAX] : DEFAULT_CATEGORY,
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
