module SttTermLearning
  # 회의 단위 되돌리기(스펙 §5.8). done run 의 item 을 id 역순으로 되돌린다. 전체가 트랜잭션 하나다.
  #   add_line (change "line"):
  #     지금 그 파일의 첫 줄(term_line) == 기록한 줄 → 줄 삭제, "reverted".
  #     이번 되돌리기에서 이미 지운 줄(같은 실행에서 한 줄에 합친 다른 항목) → "already_absent".
  #     그 밖에 다르거나 없음(사람 수정·삭제, 다른 레벨로 이동, 파일 삭제) → "skipped_changed".
  #   add_mispronunciation (change "before"·"wrong"):
  #     지금 줄 == 이 실행이 병합한 뒤의 줄(before + 같은 실행·같은 줄의 병합 변형 전부, apply_learning! 과 같은 조립)
  #       → before 로 정확히 복원(발음 표기·CRLF 포함). 같은 그룹의 나머지 항목도 "reverted".
  #     아니고 그 줄에 wrong 이 남아 있음 → 그 변형만 제거(remove_mispronunciation!), "reverted".
  #     아니면(변형·줄 없음) → "skipped_changed".
  #   change 가 없는 항목(already_known·skipped_*)은 파일을 건드리지 않고 revert_result 도 비워 둔다.
  # misrecognition 이 연결된 item 은 hit_count -= 1(0 미만 금지), 0 이면 undecided(excluded 는 유지).
  # 끝에 run.status = "reverted".
  class Reverter
    class Error < StandardError; end

    REVERTED = "reverted".freeze
    ALREADY_ABSENT = "already_absent".freeze
    SKIPPED_CHANGED = "skipped_changed".freeze

    def initialize(run)
      @run = run
    end

    # -> { reverted: Integer, skipped_item_ids: [Integer] }
    def call
      reverted = 0
      skipped = []
      ::ActiveRecord::Base.transaction do
        @run.reload
        raise Error, "완료(done)된 실행만 되돌릴 수 있습니다 (현재: #{@run.status})" unless @run.status == "done"

        reset!
        items = @run.items.order(:id).to_a
        @groups = merge_groups(items)
        items.reverse_each do |item|
          outcome = revert_item(item)
          if outcome
            item.update!(revert_result: outcome)
            reverted += 1 if outcome == REVERTED
            skipped << item.id if outcome == SKIPPED_CHANGED
          end
          decrement_hit!(item)
        end
        @run.update!(status: "reverted")
      end
      { reverted: reverted, skipped_item_ids: skipped }
    rescue ::ActiveRecord::ActiveRecordError => e
      raise Error, e.message
    end

    private

    def reset!
      @files = {}        # domain_file_id => DomainFile(트랜잭션 안에서 한 번 읽고 계속 씀)
      @removed = Set.new # [file_id, term_key] 이번 되돌리기에서 지운 새 줄
      @restored = Set.new # 이번 되돌리기에서 before 로 복원한 병합 그룹 key
    end

    def revert_item(item)
      change = item.change_data
      case change["kind"]
      when "add_line" then revert_line(change)
      when "add_mispronunciation" then revert_merge(change)
      end
    end

    def revert_line(change)
      file = file_for(change["domain_file_id"])
      key = ::DomainFile.normalize_key(change["term_key"])
      line = change["line"]
      return SKIPPED_CHANGED if file.nil? || line.nil?

      current = file.term_line(key)
      if current.nil?
        return @removed.include?([ file.id, key ]) ? ALREADY_ABSENT : SKIPPED_CHANGED
      end
      return SKIPPED_CHANGED unless current == line

      file.remove_term_line!(key)
      @removed << [ file.id, key ]
      REVERTED
    end

    def revert_merge(change)
      file = file_for(change["domain_file_id"])
      key = ::DomainFile.normalize_key(change["term_key"])
      wrong = change["wrong"].to_s
      before = change["before"]
      return SKIPPED_CHANGED if file.nil?

      gkey = group_key(change)
      return REVERTED if @restored.include?(gkey)

      current = file.term_line(key)
      return SKIPPED_CHANGED if current.nil?

      expected = merged_line(before, @groups[gkey])
      if expected && current == expected
        replace_line!(file, key, before)
        @restored << gkey
        return REVERTED
      end

      file.remove_mispronunciation!(key, wrong) ? REVERTED : SKIPPED_CHANGED
    end

    # 같은 실행에서 같은 파일·같은 줄(같은 before)에 병합한 변형들(id 순 = 병합 순).
    def merge_groups(items)
      groups = Hash.new { |h, k| h[k] = [] }
      items.each do |item|
        change = item.change_data
        next unless change["kind"] == "add_mispronunciation"
        groups[group_key(change)] << change["wrong"]
      end
      groups
    end

    def group_key(change)
      [ change["domain_file_id"], ::DomainFile.normalize_key(change["term_key"]), change["before"] ]
    end

    # DomainFile#apply_learning! 의 merge_into 와 같은 조립(용어·분류·설명은 원 줄 값, 오인식 합집합, 줄 끝 \r 보존).
    def merged_line(before, variants)
      return nil if before.nil?
      m = ::DomainFile::TERM_LINE_REGEX.match(before)
      return nil unless m
      existing = ::DomainFile.split_mispronunciations(m[3])
      merged = ::DomainFile.merge_mispronunciations(existing, variants)
      eol = before.end_with?("\r") ? "\r" : ""
      ::DomainFile.format_term_line(m[1].to_s.strip, m[2].to_s.strip, m[4].to_s.strip, merged) + eol
    end

    # key 의 첫 용어 줄을 text 로 그대로 바꾼다.
    def replace_line!(file, key, text)
      entry = file.find_term(key)
      lines = file.content.to_s.split("\n", -1)
      lines[entry[:line_no]] = text
      file.update!(content: lines.join("\n"))
    end

    def file_for(id)
      return nil if id.nil?
      return @files[id] if @files.key?(id)
      @files[id] = ::DomainFile.find_by(id: id)
    end

    def decrement_hit!(item)
      return if item.misrecognition_id.nil?
      rec = ::SttMisrecognition.find_by(id: item.misrecognition_id)
      return unless rec

      rec.hit_count = [ rec.hit_count.to_i - 1, 0 ].max
      rec.status = "undecided" if rec.hit_count.zero? && rec.status != "excluded"
      rec.save!
    end
  end
end
