class MarkdownExporter
  STATUS_LABELS = {
    "pending"   => "대기중",
    "recording" => "녹화중",
    "completed" => "완료"
  }.freeze

  # @param meeting [Meeting] ActiveRecord Meeting 인스턴스
  # @param include_summary [Boolean] AI 요약 섹션 포함 여부 (기본: true)
  # @param include_transcript [Boolean] 원본 텍스트 섹션 포함 여부 (기본: true)
  def initialize(meeting, include_summary: true, include_memo: true, include_transcript: true)
    @meeting            = meeting
    @include_summary    = include_summary
    @include_memo       = include_memo
    @include_transcript = include_transcript
  end

  # @return [String] Markdown 형식의 문자열
  def call
    sections = []
    sections << render_header
    sections << render_summary    if @include_summary
    sections << render_memo       if @include_memo
    sections << render_transcript if @include_transcript
    sections.compact.join("\n\n---\n\n")
  end

  private

  def render_header
    lines = []
    lines << "# #{@meeting.title}"
    lines << ""

    started = @meeting.started_at
    ended   = @meeting.ended_at

    date_str  = started ? started.to_date.to_s : "미정"
    start_str = started ? started.strftime("%H:%M") : "미정"
    end_str   = ended   ? ended.strftime("%H:%M")   : "진행중"

    lines << "- **날짜**: #{date_str}"
    lines << "- **시간**: #{start_str} ~ #{end_str}"
    lines << "- **상태**: #{STATUS_LABELS.fetch(@meeting.status, @meeting.status)}"
    lines << "- **생성자**: #{@meeting.creator.name}"

    lines.join("\n")
  end

  def render_summary
    summary = @meeting.active_summary
    return nil unless summary

    # notes_markdown이 있으면 우선 사용
    if summary.notes_markdown.present?
      lines = []
      lines << "## AI 회의록"
      lines << ""
      lines << summary.notes_markdown

      action_items_lines = render_action_items
      if action_items_lines
        lines << ""
        lines << action_items_lines
      end

      return lines.join("\n")
    end

    # 기존 JSON 필드 폴백
    lines = []
    lines << "## AI 요약"

    append_bullet_section(lines, "### 핵심 요약",      parse_field(summary.key_points))
    append_bullet_section(lines, "### 결정사항",        parse_field(summary.decisions))
    append_bullet_section(lines, "### 주요 논의 내용", parse_field(summary.discussion_details))

    action_items_lines = render_action_items
    if action_items_lines
      lines << ""
      lines << action_items_lines
    end

    lines.join("\n")
  end

  def render_memo
    return nil if @meeting.memo.blank?

    lines = []
    lines << "## 메모"
    lines << ""
    lines << @meeting.memo
    lines.join("\n")
  end

  def render_transcript
    transcripts = @meeting.transcripts.order(:sequence_number)

    lines = []
    lines << "## 원본 텍스트"

    if transcripts.empty?
      lines << ""
      lines << "> 원본 텍스트가 없습니다."
    else
      transcripts.each do |t|
        lines << ""
        lines << "**#{t.speaker_label}** (#{format_timestamp_ms(t.started_at_ms)})"
        lines << t.content
      end
    end

    lines.join("\n")
  end

  def render_action_items
    items = @meeting.action_items.includes(:assignee)
    return nil if items.empty?

    lines = []
    lines << "### Action Items"
    items.each do |item|
      checkbox = item.status == "done" ? "[x]" : "[ ]"
      meta_parts = []
      meta_parts << "@#{item.assignee.name}" if item.assignee
      meta_parts << "마감: #{item.due_date}" if item.due_date
      meta = meta_parts.any? ? " (#{meta_parts.join(", ")})" : ""
      lines << "- #{checkbox} #{item.content}#{meta}"
    end

    lines.join("\n")
  end

  def append_bullet_section(lines, heading, items)
    return if items.empty?

    lines << ""
    lines << heading
    items.each { |item| lines << "- #{item}" }
  end

  def parse_field(value)
    return [] if value.blank?
    parsed = JSON.parse(value)
    parsed.is_a?(Array) ? parsed : [parsed.to_s]
  rescue JSON::ParserError
    [value.to_s]
  end

  def format_timestamp_ms(ms)
    total_seconds = ms / 1000
    minutes = total_seconds / 60
    seconds = total_seconds % 60
    format("%02d:%02d", minutes, seconds)
  end
end
