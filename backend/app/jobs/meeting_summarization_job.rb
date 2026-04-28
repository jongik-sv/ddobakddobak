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

  def llm_service_for(meeting)
    llm_config = meeting.creator&.effective_llm_config
    LlmService.new(llm_config: llm_config)
  end

  def generate_minutes_realtime(meeting)
    return if meeting.completed?

    new_transcripts = meeting.transcripts
                             .where(applied_to_minutes: false)
                             .order(:sequence_number)
    return if new_transcripts.empty?

    applied_ids = new_transcripts.pluck(:id)
    channel = meeting.transcription_stream

    current_notes = meeting.current_notes_markdown
    payload = Transcript.to_sidecar_payload(new_transcripts)

    result = llm_service_for(meeting).refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees
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
  rescue LlmService::LlmError, StandardError => e
    Rails.logger.error "[MeetingSummarizationJob] realtime meeting=#{meeting.id} error=#{e.message}"
  end

  def generate_minutes_final(meeting)
    transcripts = meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    current_notes = meeting.current_notes_markdown
    payload = Transcript.to_sidecar_payload(transcripts)

    result = llm_service_for(meeting).refine_notes(
      current_notes, payload,
      meeting_title: meeting.title,
      meeting_type: meeting.meeting_type,
      sections_prompt: PromptTemplate.sections_prompt_for(meeting.meeting_type),
      attendees: meeting.attendees
    )
    notes_markdown = result["notes_markdown"]
    return if notes_markdown.blank?

    summary = meeting.summaries.find_or_initialize_by(summary_type: "final")
    summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

    meeting.refresh_brief_summary!(notes_markdown)
    meeting.transcripts.update_all(applied_to_minutes: true)

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "meeting_notes_update", notes_markdown: notes_markdown, is_final: true }
    )
  rescue LlmService::LlmError, StandardError => e
    Rails.logger.error "[MeetingSummarizationJob] final meeting=#{meeting.id} error=#{e.message}"
  end

end
