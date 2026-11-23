module SttTermLearning
  # 후보 오등록 방지 필터(스펙 §5.4). 순서대로 판정하고 처음 걸린 필터 하나만 낸다.
  #   1. 프로젝트 오인식 기록의 excluded 쌍          → skipped_excluded
  #   2. wrong==correct / 1자 이하 / 30자 초과 / 숫자·기호만 → skipped_invalid
  #   3. (llm_diff 만) 전사에 wrong 이 없음(공백 무시) → skipped_not_in_transcript
  #   4. 실효 세트에서 같은 wrong 이 다른 용어의 오인식  → skipped_conflict
  #   5. (llm_diff 만) confidence < min_confidence   → skipped_low_confidence
  # feedback 후보는 전사까지 고쳐지므로(MeetingGlossaryApplier) 3·5 를 면제한다.
  # 판정 기준(excluded 쌍·전사·실효 세트 색인)은 생성 시 한 번만 만든다. 통과한 후보는 같은 실행의 뒤 후보에
  # 대해 4 의 색인에 더한다(한 실행에서 같은 wrong 을 서로 다른 용어로 등록하지 않게).
  class CandidateFilter
    MIN_LEN = 2
    MAX_LEN = 30
    SYMBOLS_ONLY = /\A[\p{N}\p{P}\p{S}\s]+\z/

    def initialize(meeting:, transcript_text:, min_confidence:)
      @meeting = meeting
      @transcript = squash(transcript_text)
      @min_confidence = min_confidence.to_f
      @excluded_pairs = load_excluded_pairs
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

      invalid = invalid_reason(wrong_key, correct_key)
      return [ "skipped_invalid", invalid ] if invalid

      if llm && !@transcript.include?(squash(candidate.wrong))
        return [ "skipped_not_in_transcript", "전사에 '#{candidate.wrong}' 없음" ]
      end

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

    def invalid_reason(wrong_key, correct_key)
      return "wrong 과 correct 가 같음" if wrong_key == correct_key
      return "길이 #{MIN_LEN}자 미만" if wrong_key.length < MIN_LEN || correct_key.length < MIN_LEN
      return "길이 #{MAX_LEN}자 초과" if wrong_key.length > MAX_LEN || correct_key.length > MAX_LEN
      return "숫자·기호만" if wrong_key.match?(SYMBOLS_ONLY) || correct_key.match?(SYMBOLS_ONLY)
      nil
    end

    def squash(text)
      text.to_s.gsub(/\s+/, "").downcase
    end

    def load_excluded_pairs
      project_id = @meeting.project_id
      return Set.new if project_id.nil?
      ::SttMisrecognition.excluded.where(project_id: project_id).pluck(:wrong_key, :correct_key).to_set
    end

    # 오인식 key → 그 오인식을 가진 용어 줄 term key 집합 (실효 세트 전체: 회의 링크 포함, exclude 제외)
    def load_conflict_index
      index = {}
      @meeting.effective_domain_files.each do |entry|
        ::DomainFile.parse_terms(entry[:file].content).each do |t|
          term_key = ::DomainFile.normalize_key(t[:term])
          t[:mispronunciations].each do |v|
            (index[::DomainFile.normalize_key(v)] ||= Set.new) << term_key
          end
        end
      end
      index
    end
  end
end
