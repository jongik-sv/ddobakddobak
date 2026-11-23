module SttTermLearning
  # 용어 줄의 레벨 이동·복사·일괄 삭제. 한 요청 전체가 트랜잭션 하나다.
  class TermMover
    class Error < StandardError; end

    def initialize(actor:)
      @actor = actor
    end

    # moves: [{domain_file_id:, term_keys: [String]|nil, target: Level, copy: false, merge_descendants: false}]
    # 반환: { moved: 처리한 줄 수, merged: 그중 대상에 같은 용어가 있어 오인식만 합친 수 }
    def apply!(moves)
      moved = merged = 0
      ::ActiveRecord::Base.transaction do
        Array(moves).each do |raw|
          m = raw.to_h.with_indifferent_access
          r = apply_one(m)
          moved += r[:moved]
          merged += r[:merged]
        end
        ::SttTermMoveLog.create!(actor: @actor, moves: serialize(moves).to_json,
                                 result: { "moved" => moved, "merged" => merged }.to_json)
      end
      { moved: moved, merged: merged }
    rescue ::ActiveRecord::RecordNotFound, ::ActiveRecord::RecordInvalid => e
      raise Error, e.message
    end

    # items: [{domain_file_id:, term_key:}] → 지운 줄 수
    def delete!(items)
      count = 0
      ::ActiveRecord::Base.transaction do
        Array(items).each do |raw|
          i = raw.to_h.with_indifferent_access
          file = ::DomainFile.find(i[:domain_file_id])
          key = ::DomainFile.normalize_key(i[:term_key])
          raise Error, "용어를 찾을 수 없습니다: #{i[:term_key]}" unless file.remove_term_line!(key)
          count += 1
        end
        ::SttTermMoveLog.create!(actor: @actor, moves: Array(items).map { |i| i.to_h.stringify_keys }.to_json,
                                 result: { "deleted" => count }.to_json)
      end
      count
    rescue ::ActiveRecord::RecordNotFound, ::ActiveRecord::RecordInvalid => e
      raise Error, e.message
    end

    private

    def apply_one(m)
      source = ::DomainFile.find(m[:domain_file_id])
      target = m[:target]
      raise Error, "대상 레벨이 없습니다" unless target.is_a?(Level)
      target_file = AutoDomainFile.find_or_create_for!(target, fallback_creator: @actor)
      raise Error, "원본과 대상이 같은 파일입니다" if target_file.id == source.id

      keys = m[:term_keys].nil? ? source.class.parse_terms(source.content).map { |t| ::DomainFile.normalize_key(t[:term]) }.uniq : Array(m[:term_keys]).map { |k| ::DomainFile.normalize_key(k) }.uniq
      moved = merged = 0
      keys.each do |key|
        entry = source.find_term(key)
        raise Error, "용어를 찾을 수 없습니다: #{key}" unless entry
        source.remove_term_line!(key) unless m[:copy]

        variants = entry[:mispronunciations]
        target_file.reload
        if target_file.find_term(key)
          target_file.apply_learning!(merges: { key => variants })
          merged += 1
        else
          target_file.apply_learning!(new_terms: [{ term: entry[:term], category: entry[:category],
                                                    definition: entry[:definition], mispronunciations: variants }])
        end
        moved += 1
        merge_descendants!(target, target_file, source, key) if m[:merge_descendants]
      end
      { moved: moved, merged: merged }
    end

    def merge_descendants!(target, target_file, source, key)
      collected = []
      target.descendant_levels.each do |lv|
        lv.linked_files.each do |file|
          next if file.id == target_file.id || file.id == source.id
          entry = file.find_term(key)
          next unless entry
          collected.concat(entry[:mispronunciations])
          file.remove_term_line!(key)
        end
      end
      target_file.reload.apply_learning!(merges: { key => collected }) if collected.any?
    end

    def serialize(moves)
      Array(moves).map do |raw|
        m = raw.to_h.with_indifferent_access
        { "domain_file_id" => m[:domain_file_id], "term_keys" => m[:term_keys],
          "target" => m[:target].respond_to?(:ref) ? m[:target].ref.stringify_keys : nil,
          "copy" => !!m[:copy], "merge_descendants" => !!m[:merge_descendants] }
      end
    end
  end
end
