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
    @lock_token = SecureRandom.hex(16)

    if @role
      stream_from meeting.transcription_stream
      handle_host_reconnection(meeting)
      notify_if_recording_in_progress(meeting)
    else
      reject
    end
  end

  def unsubscribed
    RecordingLock.release(@meeting_id, @lock_token) if @meeting_id && @lock_token
    stop_all_streams
    handle_host_disconnection if @meeting_id
  end

  def audio_chunk(data)
    return unless @meeting_id

    # viewer는 오디오 전송 차단 (owner 또는 host만 허용)
    return if @role == MeetingParticipant::ROLE_VIEWER

    # 녹음 중인 회의에만 오디오 허용 (멈춘/완료된 회의로의 스트리밍 차단)
    meeting = Meeting.find_by(id: @meeting_id)
    return unless meeting&.recording?

    # 회의당 단일 녹음 스트림만 허용. 다른 기기가 이미 녹음 중이면
    # 이 커넥션을 viewer로 강등하고 1회 알림 후 무시한다.
    unless RecordingLock.acquire(@meeting_id, @lock_token)
      deny_recording
      return
    end

    # 회의 언어는 클라이언트가 아니라 회의 생성자의 개인 설정에서 결정한다
    # (viewer가 덮어쓰지 못하도록 서버 권위 소스 사용, 요약 LLM과 동일 패턴).
    lang = meeting.creator&.effective_language_config || ::User.server_default_language_config

    TranscriptionJob.perform_later(
      meeting_id: @meeting_id,
      audio_data: data["data"].to_s,
      sequence: data["sequence"].to_i,
      offset_ms: data["offset_ms"].to_i,
      diarization_config: data["diarization_config"],
      languages: lang[:languages],
      mode: lang[:mode],
      audio_source: data["audio_source"] || "mic"
    )
  end

  private

  # 새로 구독한 세션에게, 이미 다른 세션이 녹음(락 보유) 중이면 알림.
  # 프론트는 이 신호를 받으면 라이브페이지 대신 읽기전용 뷰어로 라우팅한다.
  def notify_if_recording_in_progress(meeting)
    return unless meeting.recording?
    return if RecordingLock.holder(@meeting_id).nil?

    transmit({ "type" => "recording_in_progress", "meeting_id" => @meeting_id })
  end

  # 다른 기기가 이미 녹음 중일 때: viewer로 강등하고 1회만 거부 알림.
  def deny_recording
    @role = MeetingParticipant::ROLE_VIEWER
    return if @recording_denied_notified

    @recording_denied_notified = true
    transmit({ "type" => "recording_denied", "meeting_id" => @meeting_id })
  end

  # 구독 권한 결정: owner / host / viewer / nil(거부)
  # admin 유저는 모든 회의에 owner 권한으로 접근 가능 (관리/모니터링 목적)
  def determine_role(meeting)
    return "owner" if current_user.respond_to?(:admin?) && current_user.admin?

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
