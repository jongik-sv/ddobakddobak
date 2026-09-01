# 세컨드 브레인 외부 API(/api/ext/v1) 전용 회의 직렬화.
#
# 내부 MeetingSerializable(app/controllers/concerns/meeting_serializable.rb)을 재사용하지
# 않는다 — 내부 응답은 Block/MeetingAttachment 등 외부에 노출하면 안 되는 필드까지 포함하므로,
# 여기서는 브리프가 명시한 최소 화이트리스트만 새로 정의한다.
module Ext::V1::MeetingSerialization
  extend ActiveSupport::Concern

  private

  def serialize_meeting_list_item(meeting)
    {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      project_id: meeting.project_id,
      folder_id: meeting.folder_id,
      created_at: meeting.created_at.iso8601,
      brief_summary: meeting.brief_summary,
      transcripts_redacted_at: meeting.transcripts_redacted_at&.iso8601,
      shared: meeting.shared
    }
  end

  def serialize_meeting_detail(meeting)
    serialize_meeting_list_item(meeting).merge(
      owner_name: meeting.creator&.name,
      transcript_count: meeting.transcripts.count,
      has_final_summary: meeting.summaries.where(summary_type: "final").exists?,
      duration_ms: meeting.audio_duration_ms
    )
  end

  def serialize_transcript(transcript)
    {
      id: transcript.id,
      speaker_label: transcript.speaker_label,
      speaker_name: transcript.speaker_name,
      content: transcript.content,
      started_at_ms: transcript.started_at_ms,
      ended_at_ms: transcript.ended_at_ms,
      sequence_number: transcript.sequence_number
    }
  end

  def serialize_ext_summary(summary)
    {
      summary_type: summary.summary_type,
      key_points: parse_json_array_field(summary.key_points),
      decisions: parse_json_array_field(summary.decisions),
      discussion_details: parse_json_array_field(summary.discussion_details),
      notes_markdown: summary.notes_markdown,
      created_at: summary.created_at.iso8601
    }
  end

  # summaries.key_points/decisions/discussion_details는 JSON 텍스트 컬럼 — 배열/객체로
  # 파싱해 반환한다. 이미 파싱된 값(테스트 더블 등)이 넘어와도 그대로 통과시킨다.
  def parse_json_array_field(value)
    return [] if value.nil?
    return value if value.is_a?(Array) || value.is_a?(Hash)

    JSON.parse(value)
  rescue JSON::ParserError
    []
  end
end
