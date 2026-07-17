# 회의의 실효 도메인 파일(용어집) 세트(meeting.effective_domain_files)를 요약 LLM 프롬프트에
# 주입할 하나의 텍스트로 병합한다.
# 파일 순서 = meeting > 가까운 folder > 먼 folder > project (구체 레벨 우선). 누적 8000자를
# 넘기면 그 시점 파일의 content를 남은 글자수까지 잘라 "…(이하 생략)"를 붙이고 이후 파일은
# 스킵한다 — 즉 캡 초과 시 project → 먼 folder → 가까운 folder → meeting 순으로 잘려나가
# 구체 레벨(회의 자신의 선택)이 끝까지 살아남는다.
# realtime(매분)·final·파일전사 요약 3경로 모두 매 틱 호출한다(agenda_reference의 1회 주입
# 플래그와 다르게 캐시하지 않음 — 도메인 파일 선택은 회의 중 언제든 바뀔 수 있어서).
class DomainReferenceBuilder
  MAX_TOTAL_CHARS = 8000
  TRUNCATE_MARKER = "\n…(이하 생략)".freeze

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
        break
      end

      blocks << block
      used += block.length + 2 # 다음 블록과의 "\n\n" join 분까지 캡에 포함
    end

    return nil if blocks.empty?
    blocks.join("\n\n")
  end
end
