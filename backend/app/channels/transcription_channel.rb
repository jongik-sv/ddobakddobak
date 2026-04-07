class TranscriptionChannel < ApplicationCable::Channel
  GRACE_PERIOD_SECONDS = 10

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
      handle_host_reconnection(meeting)
    else
      reject
    end
  end

  def unsubscribed
    stop_all_streams
    handle_host_disconnection if @meeting_id
  end

  def audio_chunk(data)
    return unless @meeting_id

    # viewer는 오디오 전송 차단 (owner 또는 host만 허용)
    return if @role == MeetingParticipant::ROLE_VIEWER

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
    if meeting.owner?(current_user)
      "owner"
    else
      meeting.active_participants.find_by(user_id: current_user.id)&.role
    end
  end

  # 호스트 재접속 시 host_disconnected_at 초기화 + 브로드캐스트
  def handle_host_reconnection(meeting)
    participant = meeting.host_participant
    return unless participant&.user_id == current_user.id
    return unless participant.host_disconnected_at.present?

    participant.update!(host_disconnected_at: nil)
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "host_reconnected", user_id: current_user.id }
    )
  end

  # 호스트 끊김 시 host_disconnected_at 설정 + grace period job 예약
  def handle_host_disconnection
    meeting = Meeting.find_by(id: @meeting_id)
    return unless meeting&.sharing?

    participant = meeting.host_participant
    return unless participant&.user_id == current_user.id

    disconnected_at = Time.current
    participant.update!(host_disconnected_at: disconnected_at)

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "host_disconnected", user_id: current_user.id, grace_period_seconds: GRACE_PERIOD_SECONDS }
    )

    HostGracePeriodJob.set(wait: GRACE_PERIOD_SECONDS.seconds).perform_later(
      meeting_id: @meeting_id,
      user_id: current_user.id,
      disconnected_at: disconnected_at.iso8601(6)
    )
  end
end
