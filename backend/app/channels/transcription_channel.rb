class TranscriptionChannel < ApplicationCable::Channel
  def subscribed
    meeting = Meeting.find_by(id: params[:meeting_id])
    if meeting && team_member?(meeting)
      @meeting_id = meeting.id
      stream_from "meeting_#{meeting.id}_transcription"
    else
      reject
    end
  end

  def unsubscribed
    stop_all_streams
  end

  def audio_chunk(data)
    return unless @meeting_id

    TranscriptionJob.perform_later(
      meeting_id: @meeting_id,
      audio_data: data["data"].to_s,
      sequence: data["sequence"].to_i,
      offset_ms: data["offset_ms"].to_i,
      diarization_config: data["diarization_config"],
      languages: data["languages"]
    )
  end

  private

  def team_member?(meeting)
    meeting.team.team_memberships.exists?(user: current_user)
  end
end
