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

    # 요약 저장 경로(MeetingSummarizationJob·FileTranscriptionJob) 공용 진입점.
    # 비활성이거나 준비 실패면 nil — 호출부는 치환을 생략하고 저장을 계속한다(요약 저장을 막지 않는다).
    def self.build_for(meeting)
      return nil unless enabled?
      applier = new(meeting)
      applier.entries # 조기 평가 — 실패를 여기서 잡는다
      applier
    rescue => e
      Rails.logger.error "[LearnedPairApplier] 학습 쌍 로드 실패 meeting=#{meeting&.id}: #{e.class}: #{e.message}"
      nil
    end

    def initialize(meeting)
      @meeting = meeting
    end

    # apply_other_columns! 의 실패 격리판 — 실패해도 로그만 남기고 0 을 반환한다.
    def apply_other_columns_safely!(summary)
      apply_other_columns!(summary)
    rescue => e
      Rails.logger.error "[LearnedPairApplier] 기타 컬럼 치환 실패 summary=#{summary&.id}: #{e.class}: #{e.message}"
      0
    end

    # [{from:, to:, match_type: "boundary"}, ...] — 긴 wrong 우선.
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
      excluded_file_ids = @meeting.domain_file_links.excluded.pluck(:domain_file_id).to_set
      pairs = SttTermLearningItem.applied_live
                                 .where(stt_term_learning_runs: { meeting_id: @meeting.id })
                                 .includes(:misrecognition, :domain_file)
                                 .order(:id)
      seen = {}
      pairs.each do |item|
        wrong = item.wrong.to_s.strip
        correct = item.correct.to_s.strip
        next if wrong.length < MIN_WRONG_LENGTH || correct.blank?
        next if wrong == correct || correct.include?(wrong) # 멱등성 — "API"→"API 서버" 가 겹치지 않게
        next if item.misrecognition&.status == "excluded"
        next if excluded.include?([ item.wrong_key, item.correct_key ])
        next unless term_still_registered?(item, excluded_file_ids)
        seen[wrong] ||= correct
      end
      seen.sort_by { |wrong, _| -wrong.length }
          .map { |wrong, correct| { from: wrong, to: correct, match_type: "boundary" } }
    end

    # 관리자가 도메인 파일에서 용어를 지웠거나 파일을 지웠으면(또는 이 회의에서 파일을 제외했으면)
    # 학습 결과가 더 이상 유효하지 않다 — 강제 치환하지 않는다. 읽기 전용 파싱(parse_terms)만 쓴다.
    def term_still_registered?(item, excluded_file_ids)
      file = item.domain_file
      return false if file.nil? || excluded_file_ids.include?(file.id)
      @term_keys ||= {}
      keys = (@term_keys[file.id] ||= ::DomainFile.parse_terms(file.content)
                                                  .map { |t| ::DomainFile.normalize_key(t[:term]) }.to_set)
      keys.include?(item.correct_key)
    end

    def excluded_keys
      return Set.new if @meeting.project_id.nil?
      SttMisrecognition.excluded.where(project_id: @meeting.project_id)
                       .pluck(:wrong_key, :correct_key).to_set
    end
  end
end
