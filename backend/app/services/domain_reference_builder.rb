# 회의의 실효 도메인 파일(용어집) 세트(meeting.effective_domain_files)를 요약 LLM 프롬프트에
# 주입할 하나의 텍스트로 병합한다.
# 파일 순서 = meeting > 가까운 folder > 먼 folder > project (구체 레벨 우선). 누적 8000자를
# 넘기면 그 시점 파일의 content를 남은 글자수까지 잘라 "…(이하 생략)"를 붙이고 이후 파일은
# 스킵한다 — 즉 캡 초과 시 project → 먼 folder → 가까운 folder → meeting 순으로 잘려나가
# 구체 레벨(회의 자신의 선택)이 끝까지 살아남는다.
# realtime(매분)·final·파일전사 요약 3경로 모두 매 틱 호출한다(agenda_reference의 1회 주입
# 플래그와 다르게 캐시하지 않음 — 도메인 파일 선택은 회의 중 언제든 바뀔 수 있어서).
#
# 오인식 교정 블록: 실효 파일들의 용어 중 (오인식: ...)이 있는 것들을 모아 "변형→용어" 목록으로
# 파일 블록들 뒤에 덧붙인다(같은 8000자 캡 공유). 변형이 여러 파일에서 겹치면 구체 레벨(파일
# 순서상 앞) 우선으로 하나만 채택한다. 캡이 부족하면 앞(구체 레벨)부터 채우고 뒤(project 등
# 먼 레벨)의 변형을 통째로 드롭한다(문자 단위 절삭 없음 — 쌍 단위로만 자른다).
class DomainReferenceBuilder
  MAX_TOTAL_CHARS = 8000
  TRUNCATE_MARKER = "\n…(이하 생략)".freeze
  CORRECTION_HEADER = "다음은 STT 오인식 가능 표기다. 요약 시 올바른 용어로 교정하라: ".freeze

  # @param meeting [Meeting]
  # @return [String, nil] 실효 파일이 0개거나 전부 content blank면 nil
  def self.build(meeting)
    files = meeting.effective_domain_files.map { |entry| entry[:file] }
    files = files.reject { |f| f.content.blank? }
    return nil if files.empty?

    blocks = []
    used = 0

    files.each do |file|
      remaining = MAX_TOTAL_CHARS - used
      break if remaining <= 0

      header = "## #{file.name}\n"
      block = "#{header}#{file.content}"

      if block.length > remaining
        break if header.length + TRUNCATE_MARKER.length > remaining

        allowed_content_len = remaining - header.length - TRUNCATE_MARKER.length
        block = "#{header}#{file.content[0, allowed_content_len]}#{TRUNCATE_MARKER}"
        blocks << block
        used += block.length + 2
        break
      end

      blocks << block
      used += block.length + 2 # 다음 블록과의 "\n\n" join 분까지 캡에 포함
    end

    remaining_for_correction = MAX_TOTAL_CHARS - used - 2 # blocks.join("\n\n")의 "\n\n" 2자
    if remaining_for_correction > 0
      correction_block = build_correction_block(files, remaining_for_correction)
      blocks << correction_block if correction_block
    end

    return nil if blocks.empty?
    blocks.join("\n\n")
  end

  # files(구체 레벨 우선 순서)에서 오인식 변형을 모아 "변형→용어" 교정 블록을 만든다.
  # @return [String, nil] 교정 대상이 없거나 헤더조차 들어갈 자리가 없으면 nil
  def self.build_correction_block(files, remaining)
    return nil if remaining <= 0

    seen_variants = {}
    pairs = []

    files.each do |file|
      DomainFile.parse_terms(file.content).each do |entry|
        entry[:mispronunciations].each do |variant|
          key = DomainFile.normalize_key(variant)
          next if seen_variants[key]
          seen_variants[key] = true
          pairs << "#{variant}→#{entry[:term]}"
        end
      end
    end
    return nil if pairs.empty?

    return nil if CORRECTION_HEADER.length > remaining

    included = []
    used = CORRECTION_HEADER.length
    pairs.each do |pair|
      sep_len = included.empty? ? 0 : 2 # ", "
      needed = pair.length + sep_len
      break if used + needed > remaining

      included << pair
      used += needed
    end

    return nil if included.empty?
    "#{CORRECTION_HEADER}#{included.join(', ')}"
  end
end
