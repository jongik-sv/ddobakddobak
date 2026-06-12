module TranscriptSerializable
  extend ActiveSupport::Concern

  private

  def transcript_json(t)
    {
      id: t.id,
      content: t.content,
      speaker_label: t.speaker_label,
      speaker_name: t.speaker_name,
      started_at_ms: t.started_at_ms,
      ended_at_ms: t.ended_at_ms,
      sequence_number: t.sequence_number,
      applied_to_minutes: t.applied_to_minutes
    }
  end
end
