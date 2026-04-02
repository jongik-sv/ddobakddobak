class MeetingExportSerializer
  STATUS_LABELS = MarkdownExporter::STATUS_LABELS

  # @param meeting [Meeting] ActiveRecord Meeting 인스턴스
  # @param include_summary [Boolean] AI 요약 섹션 포함 여부 (기본: true)
  # @param include_transcript [Boolean] 원본 텍스트 섹션 포함 여부 (기본: true)
  def initialize(meeting, include_summary: true, include_memo: true, include_transcript: true)
    @meeting            = meeting
    @include_summary    = include_summary
    @include_memo       = include_memo
    @include_transcript = include_transcript
  end

  # @return [Hash] 프론트엔드에서 PDF/DOCX 생성에 사용할 구조화된 데이터
  def call
    data = { meeting: build_meeting }
    data[:summary]      = build_summary      if @include_summary
    data[:memo]         = @meeting.memo       if @include_memo
    data[:action_items] = build_action_items
    data[:transcripts]  = build_transcripts  if @include_transcript
    data
  end

  private

  def build_meeting
    started = @meeting.started_at
    ended   = @meeting.ended_at

    {
      id:           @meeting.id,
      title:        @meeting.title,
      date:         started ? started.to_date.to_s : "미정",
      start_time:   started ? started.strftime("%H:%M") : "미정",
      end_time:     ended   ? ended.strftime("%H:%M")   : "진행중",
      status:       STATUS_LABELS.fetch(@meeting.status, @meeting.status),
      creator_name: @meeting.creator.name
    }
  end

  def build_summary
    summary = @meeting.active_summary
    return nil unless summary

    if summary.notes_markdown.present?
      {
        type:               "notes_markdown",
        notes_markdown:     summary.notes_markdown,
        key_points:         nil,
        decisions:          nil,
        discussion_details: nil
      }
    else
      {
        type:               "json_fields",
        notes_markdown:     nil,
        key_points:         parse_field(summary.key_points),
        decisions:          parse_field(summary.decisions),
        discussion_details: parse_field(summary.discussion_details)
      }
    end
  end

  def build_action_items
    @meeting.action_items.includes(:assignee).map do |item|
      {
        content:       item.content,
        status:        item.status,
        assignee_name: item.assignee&.name,
        due_date:      item.due_date&.to_s
      }
    end
  end

  def build_transcripts
    @meeting.transcripts.order(:sequence_number).map do |t|
      {
        speaker_label: t.speaker_label,
        timestamp:     format_timestamp_ms(t.started_at_ms),
        content:       t.content
      }
    end
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
