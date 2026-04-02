class TranscriptionChannel < ApplicationCable::Channel
  def subscribed
    meeting = Meeting.find_by(id: params[:meeting_id])
    unless meeting
      reject
      return
    end

    @meeting_id = meeting.id
    @role = determine_role(meeting)

    if @role
      stream_from meeting.transcription_stream
    else
      reject
    end
  end

  def unsubscribed
    stop_all_streams
  end

  def audio_chunk(data)
    return unless @meeting_id

    # viewer는 오디오 전송 차단 (owner 또는 host만 허용)
    return if @role == "viewer"

    TranscriptionJob.perform_later(
      meeting_id: @meeting_id,
      audio_data: data["data"].to_s,
      sequence: data["sequence"].to_i,
      offset_ms: data["offset_ms"].to_i,
      diarization_config: data["diarization_config"],
      languages: data["languages"],
      audio_source: data["audio_source"] || "mic"
    )
  end

  private

  # 구독 권한 결정: owner / host / viewer / nil(거부)
  def determine_role(meeting)
    if meeting.created_by_id == current_user.id
      "owner"
    else
      participant = MeetingParticipant.find_by(
        meeting_id: meeting.id,
        user_id: current_user.id,
        left_at: nil
      )
      participant&.role
    end
  end
end
