module SttTermLearning
  # 이 회의에서 학습된(wrong → correct) 쌍을 AI 가 새로 쓴 요약에 확정 치환한다.
  # LLM 은 도메인 파일의 교정 힌트를 무시할 수 있고, 재작성 시 학습 잡이 아직 안 끝났을 수도 있어
  # "고친 용어가 되돌아가는" 문제가 생긴다 — 프롬프트 의존 없이 literal 치환으로 보장한다.
  # 전사는 건드리지 않는다. 인용 마커(⟦…⟧)는 apply_protecting_markers 로 보호한다.
  class LearnedPairApplier
    MIN_WRONG_LENGTH = 2

    def self.enabled?
      AppSettings.stt_term_learning["enabled"] == true
    end

    def initialize(meeting)
      @meeting = meeting
    end

    # [{from:, to:, match_type: "literal"}, ...] — 긴 wrong 우선.
    def entries
      @entries ||= build_entries
    end

    # 마커를 보호하며 치환한 텍스트. 대상이 없으면 원문 그대로.
    def apply_text(text)
      return text if text.blank? || entries.empty?
      GlossaryApplication.apply_protecting_markers(text, entries)
    end

    # notes_markdown 이외의 요약 컬럼(key_points 등)을 치환해 저장한다. 변경 컬럼 수 반환.
    def apply_other_columns!(summary)
      return 0 if entries.empty?
      attrs = {}
      (MeetingGlossaryApplier::SUMMARY_COLS - [ :notes_markdown ]).each do |col|
        original = summary[col]
        next if original.blank?
        corrected = apply_text(original)
        attrs[col] = corrected if corrected != original
      end
      summary.update!(attrs) if attrs.any?
      attrs.size
    end

    private

    def build_entries
      excluded = excluded_keys
      pairs = SttTermLearningItem.applied_live
                                 .where(stt_term_learning_runs: { meeting_id: @meeting.id })
                                 .includes(:misrecognition)
                                 .order(:id)
      seen = {}
      pairs.each do |item|
        wrong = item.wrong.to_s.strip
        correct = item.correct.to_s.strip
        next if wrong.length < MIN_WRONG_LENGTH || correct.blank?
        next if wrong == correct || correct.include?(wrong) # 멱등성 — "API"→"API 서버" 가 겹치지 않게
        next if item.misrecognition&.status == "excluded"
        next if excluded.include?([ item.wrong_key, item.correct_key ])
        seen[wrong] ||= correct
      end
      seen.sort_by { |wrong, _| -wrong.length }
          .map { |wrong, correct| { from: wrong, to: correct, match_type: "literal" } }
    end

    def excluded_keys
      return Set.new if @meeting.project_id.nil?
      SttMisrecognition.excluded.where(project_id: @meeting.project_id)
                       .pluck(:wrong_key, :correct_key).to_set
    end
  end
end
