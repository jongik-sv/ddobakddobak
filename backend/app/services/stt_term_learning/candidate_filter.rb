module SttTermLearning
  # 후보 오등록 방지 필터(스펙 §5.4). 순서대로 판정하고 처음 걸린 필터 하나만 낸다.
  #   1. 프로젝트 오인식 기록의 excluded 쌍          → skipped_excluded
  #      이 회의의 되돌린(reverted) run 에서 적용됐던 쌍 → skipped_excluded / reason "reverted_pair"
  #      (관리자가 되돌린 등록이 같은 회의의 다음 편집으로 다시 들어오지 않게. 수동 등록은 이 필터를 건너뛴다)
  #   2. 용어 줄 구분자 포함 / wrong==correct / 1자 이하 / 30자 초과 / 숫자·기호만 → skipped_invalid
  #      (구분자 ( ) [ ] , * : 개행은 "- **용어** [분류] (오인식: …): 설명" 줄을 깨뜨린다 → reason "format_chars")
  #   3. (llm_diff 만) 전사에 wrong 이 없음(공백 무시) → skipped_not_in_transcript
  #   4. wrong 자체가 실효 세트의 용어 key          → skipped_conflict / reason "wrong_is_term"
  #      실효 세트에서 같은 wrong 이 다른 용어의 오인식  → skipped_conflict
  #   5. (llm_diff 만) confidence < min_confidence   → skipped_low_confidence
  # feedback 후보는 전사까지 고쳐지므로(MeetingGlossaryApplier) 3·5 를 면제한다.
  # 전사 대조(3)는 NFC 정규화 후 유니코드 공백([[:space:]], U+3000 포함)을 모두 지우고 비교한다.
  # 판정 기준(excluded·되돌린 쌍·전사·실효 세트 색인)은 생성 시 한 번만 만든다. 통과한 후보는 같은 실행의 뒤 후보에
  # 대해 4 의 색인에 더한다(한 실행에서 같은 wrong 을 서로 다른 용어로 등록하지 않게).
  class CandidateFilter
    MIN_LEN = 2
    MAX_LEN = 30
    SYMBOLS_ONLY = /\A[\p{N}\p{P}\p{S}\s]+\z/
    FORMAT_CHARS = /[()\[\],*:\n\r]/
    FORMAT_CHARS_REASON = "format_chars".freeze
    REVERTED_PAIR_REASON = "reverted_pair".freeze
    WRONG_IS_TERM_REASON = "wrong_is_term".freeze

    def initialize(meeting:, transcript_text:, min_confidence:)
      @meeting = meeting
      @transcript = squash(transcript_text)
      @min_confidence = min_confidence.to_f
      @excluded_pairs = load_excluded_pairs
      @reverted_pairs = load_reverted_pairs
      @term_keys = Set.new
      @term_keys_by_wrong = load_conflict_index
    end

    # -> [nil, nil] (통과) | [verdict, reason]
    def verdict_for(candidate)
      wrong_key = candidate.wrong_key
      correct_key = candidate.correct_key
      llm = candidate.source == "llm_diff"

      if @excluded_pairs.include?([ wrong_key, correct_key ])
        return [ "skipped_excluded", "제외된 오인식 쌍" ]
      end
      if @reverted_pairs.include?([ wrong_key, correct_key ])
        return [ "skipped_excluded", REVERTED_PAIR_REASON ]
      end

      invalid = invalid_reason(candidate.wrong.to_s, candidate.correct.to_s, wrong_key, correct_key)
      return [ "skipped_invalid", invalid ] if invalid

      if llm && !@transcript.include?(squash(candidate.wrong))
        return [ "skipped_not_in_transcript", "전사에 '#{candidate.wrong}' 없음" ]
      end

      return [ "skipped_conflict", WRONG_IS_TERM_REASON ] if @term_keys.include?(wrong_key)

      others = (@term_keys_by_wrong[wrong_key] || []).reject { |k| k == correct_key }
      if others.any?
        return [ "skipped_conflict", "이미 다른 용어의 오인식: #{others.first}" ]
      end

      if llm && candidate.confidence.to_f < @min_confidence
        return [ "skipped_low_confidence", "confidence #{candidate.confidence.inspect} < #{@min_confidence}" ]
      end

      (@term_keys_by_wrong[wrong_key] ||= Set.new) << correct_key
      [ nil, nil ]
    end

    private

    def invalid_reason(wrong, correct, wrong_key, correct_key)
      return FORMAT_CHARS_REASON if wrong.match?(FORMAT_CHARS) || correct.match?(FORMAT_CHARS)
      return "wrong 과 correct 가 같음" if wrong_key == correct_key
      return "길이 #{MIN_LEN}자 미만" if wrong_key.length < MIN_LEN || correct_key.length < MIN_LEN
      return "길이 #{MAX_LEN}자 초과" if wrong_key.length > MAX_LEN || correct_key.length > MAX_LEN
      return "숫자·기호만" if wrong_key.match?(SYMBOLS_ONLY) || correct_key.match?(SYMBOLS_ONLY)
      nil
    end

    def squash(text)
      text.to_s.unicode_normalize(:nfc).gsub(/[[:space:]]+/, "").downcase
    end

    def load_excluded_pairs
      project_id = @meeting.project_id
      return Set.new if project_id.nil?
      ::SttMisrecognition.excluded.where(project_id: project_id).pluck(:wrong_key, :correct_key).to_set
    end

    # 이 회의의 되돌린 run 에서 적용(registered·merged_existing·already_known)됐던 [wrong_key, correct_key].
    def load_reverted_pairs
      return Set.new if @meeting.id.nil?
      ::SttTermLearningItem.joins(:run)
                           .where(stt_term_learning_runs: { meeting_id: @meeting.id, status: "reverted" })
                           .where(verdict: ::SttTermLearningItem::APPLIED_VERDICTS)
                           .pluck(:wrong_key, :correct_key).to_set
    end

    # 오인식 key → 그 오인식을 가진 용어 줄 term key 집합 (실효 세트 전체: 회의 링크 포함, exclude 제외).
    # 같은 순회에서 실효 세트의 용어 key 전부를 @term_keys 에 모은다(wrong_is_term 판정용).
    def load_conflict_index
      index = {}
      @meeting.effective_domain_files.each do |entry|
        ::DomainFile.parse_terms(entry[:file].content).each do |t|
          term_key = ::DomainFile.normalize_key(t[:term])
          @term_keys << term_key
          t[:mispronunciations].each do |v|
            (index[::DomainFile.normalize_key(v)] ||= Set.new) << term_key
          end
        end
      end
      index
    end
  end
end
