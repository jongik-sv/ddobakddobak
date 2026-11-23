module SttTermLearning
  # 필터를 통과한 후보를 레벨 체인 중복 방지 규칙(스펙 §5.5)으로 등록한다.
  #   - 체인(가까운 폴더 → 상위 폴더 → 프로젝트 → 전역)의 링크된 모든 파일(사람·자동)에서 correct 용어를 찾는다.
  #     가장 가까운 레벨의 그 줄에 wrong 을 오인식으로 병합(merged_existing). 이미 있으면 already_known.
  #   - 못 찾으면 가장 가까운 폴더(없으면 프로젝트)의 자동 파일에 새 줄(registered). 둘 다 없으면 skipped_no_level.
  #   - 형제·자손 레벨은 보지도 건드리지도 않는다.
  # register 는 쓰기를 보류하고 결과만 낸다. flush! 가 파일마다 apply_learning! 한 번으로 저장한다
  # (사람 줄의 용어·분류·설명은 apply_learning! 이 보존). 파일 용량(MAX_CONTENT_CHARS)을 넘길 후보는
  # register 시점에 skipped_invalid / reason "file_full" 로 돌려 실행 전체가 실패하지 않게 한다.
  class Registrar
    DEFAULT_CATEGORY = "STT".freeze
    DEFINITION_MAX = 60
    FILE_FULL = "file_full".freeze

    def initialize(meeting, fallback_creator: meeting.creator)
      @meeting = meeting
      @fallback_creator = fallback_creator
      @chain = LevelChain.for_meeting(meeting)
      reset!
    end

    # -> { verdict:, reason:, domain_file:, level:, change: Hash|nil }  (change 는 String 키 JSON)
    def register(candidate)
      key = candidate.correct_key
      wrong = candidate.wrong.to_s.strip
      wrong_key = candidate.wrong_key

      found = locate(key)
      if found.nil?
        target = @chain.find { |lv| !lv.global? }
        return result("skipped_no_level", reason: "등록할 폴더·프로젝트 없음") unless target

        file = cached(AutoDomainFile.find_or_create_for!(target, fallback_creator: @fallback_creator))
        # 사람이 링크를 지웠던 기존 자동 파일이 재링크된 경우 그 안에 이미 용어가 있을 수 있다.
        entry = file.find_term(key)
        return new_line(candidate, key, wrong, target, file) unless entry
        found = [ target, file, entry ]
      end

      level, file, entry = found
      entry == :pending ? add_to_pending(key, wrong, wrong_key, level, file) : merge_existing(key, wrong, wrong_key, entry, level, file)
    end

    def flush!
      ::ActiveRecord::Base.transaction(requires_new: true) do
        @order.each do |file_id|
          file = @files[file_id].reload
          merges = @merges[file_id] || {}
          new_terms = @pending_new.values.select { |p| p[:file].id == file_id }.map { |p| p[:term] }
          next if merges.empty? && new_terms.empty?

          begin
            changed = file.apply_learning!(merges: merges, new_terms: new_terms)
          rescue ::ActiveRecord::RecordInvalid
            # register 뒤 다른 쓰기로 파일이 늘어 한도를 넘긴 경우: 이 파일 보류분만 file_full 로 돌리고 계속.
            # 검증 실패는 SQL 전에 나므로 savepoint 는 그대로 쓸 수 있다.
            raise unless file.errors.of_kind?(:content, :too_long)
            file.restore_attributes
            @results_by_file[file_id].each { |r| r.merge!(verdict: "skipped_invalid", reason: FILE_FULL, change: nil) }
            next
          end
          @pending_new.each do |key, p|
            next unless p[:file].id == file_id
            line = changed[key] || file.term_line(key)
            p[:results].each { |r| r[:change]["line"] = line }
          end
        end
      end
      reset!
      nil
    end

    private

    def reset!
      @pending_new = {} # term_key => { file:, level:, term: {term:, category:, definition:, mispronunciations:}, results: [] }
      @merges = {}      # file_id => { term_key => [wrong, ...] }
      @files = {}       # file_id => DomainFile(트랜잭션 안에서 reload 한 인스턴스)
      @order = []       # 저장 순서(처음 보류한 순)
      @extra = Hash.new(0) # file_id => 보류한 쓰기로 늘어날 글자 수
      @line_growth = {} # [file_id, term_key] => 병합으로 늘어난 글자 수(그 줄 누적)
      @results_by_file = Hash.new { |h, k| h[k] = [] } # file_id => 쓰기를 보류한 결과 Hash 들
    end

    # 같은 실행에서 보류한 새 줄 → 체인(가까운 레벨부터, 레벨 안은 링크 id 순, 사람·자동 구분 없음).
    def locate(key)
      if (pending = @pending_new[key])
        return [ pending[:level], pending[:file], :pending ]
      end
      @chain.each do |level|
        level.linked_files.each do |file|
          file = cached(file)
          entry = file.find_term(key)
          return [ level, file, entry ] if entry
        end
      end
      nil
    end

    def cached(file)
      @files[file.id] ||= file.reload
    end

    def merge_existing(key, wrong, wrong_key, entry, level, file)
      queued = (@merges[file.id] || {})[key] || []
      known = (entry[:mispronunciations] + queued).map { |v| ::DomainFile.normalize_key(v) }
      return result("already_known", domain_file: file, level: level) if known.include?(wrong_key)

      variants = ::DomainFile.merge_mispronunciations(entry[:mispronunciations] + queued, [ wrong ])
      projected = ::DomainFile.format_term_line(entry[:term], entry[:category], entry[:definition], variants)
      original = file.term_line(key).to_s.delete_suffix("\r")
      growth = projected.length - original.length
      delta = growth - (@line_growth[[ file.id, key ]] || 0)
      return file_full(file, level) unless fits?(file, delta)

      @extra[file.id] += delta
      @line_growth[[ file.id, key ]] = growth
      ((@merges[file.id] ||= {})[key] ||= []) << wrong
      enqueue(file)
      r = result("merged_existing", domain_file: file, level: level,
                 change: { "kind" => "add_mispronunciation", "domain_file_id" => file.id, "term_key" => key, "wrong" => wrong })
      @results_by_file[file.id] << r
      r
    end

    def new_line(candidate, key, wrong, level, file)
      term = {
        term: candidate.correct.to_s.strip,
        category: candidate.category.to_s.strip.presence || DEFAULT_CATEGORY,
        definition: candidate.definition.to_s.strip[0, DEFINITION_MAX],
        mispronunciations: [ wrong ]
      }
      delta = line_length(term) + (base_empty?(file) && no_new_lines?(file) ? 0 : 1)
      return file_full(file, level) unless fits?(file, delta)

      @extra[file.id] += delta
      pending = @pending_new[key] = { file: file, level: level, term: term, results: [] }
      enqueue(file)
      pending_result(pending, key)
    end

    def add_to_pending(key, wrong, wrong_key, level, file)
      pending = @pending_new[key]
      term = pending[:term]
      if term[:mispronunciations].any? { |v| ::DomainFile.normalize_key(v) == wrong_key }
        return result("already_known", domain_file: file, level: level)
      end

      before = line_length(term)
      variants = ::DomainFile.merge_mispronunciations(term[:mispronunciations], [ wrong ])
      delta = line_length(term.merge(mispronunciations: variants)) - before
      return file_full(file, level) unless fits?(file, delta)

      @extra[file.id] += delta
      term[:mispronunciations] = variants
      pending_result(pending, key)
    end

    def pending_result(pending, key)
      r = result("registered", domain_file: pending[:file], level: pending[:level],
                 change: { "kind" => "add_line", "domain_file_id" => pending[:file].id, "term_key" => key, "line" => nil })
      pending[:results] << r
      @results_by_file[pending[:file].id] << r
      r
    end

    def line_length(term)
      ::DomainFile.format_term_line(term[:term], term[:category], term[:definition], term[:mispronunciations]).length
    end

    def base_empty?(file)
      file.content.to_s.split("\n", -1).empty?
    end

    def no_new_lines?(file)
      @pending_new.none? { |_, p| p[:file].id == file.id }
    end

    def fits?(file, delta)
      file.content.to_s.length + @extra[file.id] + delta <= ::DomainFile::MAX_CONTENT_CHARS
    end

    def file_full(file, level)
      result("skipped_invalid", reason: FILE_FULL, domain_file: file, level: level)
    end

    def enqueue(file)
      @order << file.id unless @order.include?(file.id)
    end

    def result(verdict, reason: nil, domain_file: nil, level: nil, change: nil)
      { verdict: verdict, reason: reason, domain_file: domain_file, level: level, change: change }
    end
  end
end
