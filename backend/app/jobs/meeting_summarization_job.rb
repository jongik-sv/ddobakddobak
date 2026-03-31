class MeetingSummarizationJob < ApplicationJob
  queue_as :summarization

  def perform(meeting_id, type: "realtime")
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    case type
    when "final"
      generate_minutes_final(meeting)
    else
      generate_minutes_realtime(meeting)
    end
  end

  private

  def generate_minutes_realtime(meeting)
    return if meeting.completed?

    new_transcripts = meeting.transcripts
                             .where(applied_to_minutes: false)
                             .order(:sequence_number)
    return if new_transcripts.empty?

    applied_ids = new_transcripts.pluck(:id)
    channel = "meeting_#{meeting.id}_transcription"

    current_notes = current_notes_markdown(meeting)
    payload = transcripts_payload(new_transcripts)

    result = SidecarClient.new.refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: sections_prompt_for(meeting)
    )
    notes_markdown = result["notes_markdown"]

    if notes_markdown.present?
      summary = meeting.summaries.find_or_initialize_by(summary_type: "realtime")
      summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

      meeting.refresh_brief_summary!(notes_markdown)
      meeting.transcripts.where(id: applied_ids).update_all(applied_to_minutes: true)

      ActionCable.server.broadcast(channel, {
        type: "meeting_notes_update",
        notes_markdown: notes_markdown
      })

      ActionCable.server.broadcast(channel, {
        type: "transcripts_applied",
        ids: applied_ids
      })
    end
  rescue SidecarClient::SidecarError => e
    Rails.logger.error "[MeetingSummarizationJob] realtime meeting=#{meeting.id} error=#{e.message}"
  end

  def generate_minutes_final(meeting)
    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    current_notes = current_notes_markdown(meeting)
    payload = transcripts_payload(transcripts)

    result = SidecarClient.new.refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: sections_prompt_for(meeting)
    )
    notes_markdown = result["notes_markdown"]
    return if notes_markdown.blank?

    summary = meeting.summaries.find_or_initialize_by(summary_type: "final")
    summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

    meeting.refresh_brief_summary!(notes_markdown)
    meeting.transcripts.update_all(applied_to_minutes: true)

    ActionCable.server.broadcast(
      "meeting_#{meeting.id}_transcription",
      { type: "meeting_notes_update", notes_markdown: notes_markdown, is_final: true }
    )
  rescue SidecarClient::SidecarError => e
    Rails.logger.error "[MeetingSummarizationJob] final meeting=#{meeting.id} error=#{e.message}"
  end

  def current_notes_markdown(meeting)
    latest = meeting.summaries.order(generated_at: :desc).first
    latest&.notes_markdown.to_s
  end

  def transcripts_payload(transcripts)
    transcripts.map do |t|
      { speaker: t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
    end
  end

  def sections_prompt_for(meeting)
    template = PromptTemplate.find_by(meeting_type: meeting.meeting_type)
    template&.sections_prompt || PromptTemplate::DEFAULT_TEMPLATES.dig(meeting.meeting_type, :sections_prompt)
  end
end
