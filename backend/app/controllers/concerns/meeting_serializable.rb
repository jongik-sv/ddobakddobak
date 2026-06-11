module MeetingSerializable
  extend ActiveSupport::Concern

  private

  def meeting_json(meeting, full: false)
    attachment_counts = meeting.meeting_attachments.loaded? ?
      meeting.meeting_attachments.group_by(&:category).transform_values(&:size) :
      meeting.meeting_attachments.group(:category).count

    json = {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      meeting_type: meeting.meeting_type,
      started_at: meeting.started_at,
      ended_at: meeting.ended_at,
      created_by_id: meeting.created_by_id,
      created_by: { id: meeting.created_by_id, name: meeting.creator&.name },
      shared: meeting.shared,
      editable: meeting.editable_by?(current_user),
      brief_summary: meeting.brief_summary,
      source: meeting.source,
      transcription_progress: meeting.transcription_progress,
      has_audio_file: meeting.audio_file_path.present?,
      folder_id: meeting.folder_id,
      memo: meeting.memo,
      attendees: meeting.attendees,
      summary_verbosity: meeting.summary_verbosity,
      summary_restructure: meeting.summary_restructure,
      tags: meeting.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
      attachment_counts: {
        agenda: attachment_counts["agenda"] || 0,
        reference: attachment_counts["reference"] || 0,
        minutes: attachment_counts["minutes"] || 0
      },
      created_at: meeting.created_at,
      updated_at: meeting.updated_at
    }

    if full
      # 유효 폴더 공유 상태(없으면 nil). 조상 중 하나라도 비공개면 false.
      # EditMeetingDialog에서 "폴더가 비공개라 회의도 숨김" 안내용.
      json[:folder_shared] = meeting.folder&.effectively_shared?
      json[:audio_duration_ms] = audio_duration_ms(meeting)
      json[:last_transcript_end_ms] = meeting.transcripts.maximum(:ended_at_ms).to_i
      json[:last_sequence_number] = meeting.transcripts.maximum(:sequence_number).to_i
      json[:transcripts]   = serialize_transcripts(meeting)
      json[:summary]       = serialize_summary(meeting)
      json[:action_items]  = serialize_action_items(meeting)
    end

    json
  end

  def serialize_transcripts(meeting)
    meeting.transcripts.order(:started_at_ms).map do |t|
      {
        id: t.id,
        content: t.content,
        speaker_label: t.speaker_label,
        sequence_number: t.sequence_number,
        started_at_ms: t.started_at_ms,
        ended_at_ms: t.ended_at_ms
      }
    end
  end

  def serialize_summary(meeting)
    summary = meeting.active_summary
    return nil unless summary

    serialize_summary_hash(summary)
  end

  def serialize_summary_hash(summary)
    {
      id: summary.id,
      summary_type: summary.summary_type,
      key_points: parse_json_field(summary.key_points),
      decisions: parse_json_field(summary.decisions),
      discussion_details: parse_json_field(summary.discussion_details),
      notes_markdown: summary.notes_markdown,
      generated_at: summary.generated_at
    }
  end

  def parse_json_field(value)
    return [] if value.nil?
    return value if value.is_a?(Array)
    JSON.parse(value)
  rescue JSON::ParserError
    []
  end

  def serialize_action_items(meeting)
    meeting.action_items.order(:created_at).map do |ai|
      {
        id: ai.id,
        content: ai.content,
        status: ai.status,
        ai_generated: ai.ai_generated,
        created_at: ai.created_at
      }
    end
  end

  def audio_duration_ms(meeting)
    path = meeting.audio_file_path
    return 0 unless path.present? && File.exist?(path)

    output = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (output.to_f * 1000).to_i
  rescue StandardError
    0
  end
end
