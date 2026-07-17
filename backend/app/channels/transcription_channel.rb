require "base64"

class TranscriptionChannel < ApplicationCable::Channel
  ROLE_OWNER  = "owner".freeze
  ROLE_VIEWER = "viewer".freeze

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
      notify_if_recording_in_progress(meeting)
    else
      reject
    end
  end

  def unsubscribed
    RecordingLock.release(@meeting_id, @lock_token) if @meeting_id && @lock_token
    stop_all_streams
  end

  # 녹음 클라 생존 신호. 프론트가 ~15초마다 호출(VAD/일시정지 무관).
  def heartbeat(_data = {})
    bump_recorder_heartbeat
  end

  def audio_chunk(data)
    return unless @meeting_id

    # viewer는 오디오 전송 차단 (owner만 허용)
    return if @role == ROLE_VIEWER

    # 녹음 중인 회의에만 오디오 허용 (멈춘/완료된 회의로의 스트리밍 차단)
    meeting = Meeting.find_by(id: @meeting_id)
    return unless meeting&.recording?

    # 회의당 단일 녹음 스트림만 허용. 다른 기기가 이미 녹음 중이면
    # 이 커넥션을 viewer로 강등하고 1회 알림 후 무시한다.
    unless RecordingLock.acquire(@meeting_id, @lock_token)
      deny_recording
      return
    end

    # 실제 녹음 청크를 보내는 세션은 곧 살아 있는 recorder → 공짜 하트비트(presence).
    bump_recorder_heartbeat

    # 회의 언어는 클라이언트가 아니라 회의 생성자의 개인 설정에서 결정한다
    # (viewer가 덮어쓰지 못하도록 서버 권위 소스 사용, 요약 LLM과 동일 패턴).
    lang = meeting.creator&.effective_language_config || ::User.server_default_language_config

    job_args = {
      meeting_id: @meeting_id,
      sequence: data["sequence"].to_i,
      offset_ms: data["offset_ms"].to_i,
      diarization_config: data["diarization_config"],
      languages: lang[:languages],
      mode: lang[:mode],
      audio_source: data["audio_source"] || "mic"
    }.merge(audio_arg(data["data"].to_s, @meeting_id, data["sequence"].to_i))

    TranscriptionJob.perform_later(**job_args)
  end

  private

  # base64 오디오를 디스크 파일로 우회시켜 잡 인자에는 경로만 싣는다(큐 DB 비대 방지).
  # 디코드 실패·파일 쓰기 실패 시에는 기존처럼 base64를 그대로 인자에 실어 폴백한다
  # (가용성 보존 — 이 경로는 현행 동작으로 강등될 뿐 청크를 드랍하지 않는다).
  def audio_arg(base64, meeting_id, sequence)
    binary = Base64.strict_decode64(base64)
    path = SttChunkStorage.write_chunk(meeting_id, sequence, binary)
    { audio_path: path }
  rescue ArgumentError, SystemCallError, IOError => e
    Rails.logger.warn("[TranscriptionChannel] 청크 파일 저장 실패, 인라인 폴백 meeting=#{meeting_id}: #{e.message}")
    { audio_data: base64 }
  end

  # 녹음 클라 생존 신호. owner + recording 일 때만, 10초 throttle 로 DB 갱신.
  # update_column 으로 검증/콜백/updated_at 우회(쓰기 폭주 방지). presence 부재 시
  # Meeting#heal_stale_recording! 가 stale 로 보고 종결.
  def bump_recorder_heartbeat
    return unless @meeting_id
    return unless @role == ROLE_OWNER

    meeting = Meeting.find_by(id: @meeting_id)
    return unless meeting&.recording?

    last = meeting.recorder_heartbeat_at
    return if last.present? && last > 10.seconds.ago

    meeting.update_column(:recorder_heartbeat_at, Time.current)
  end

  # 새로 구독한 세션에게, 이미 다른 세션이 녹음(락 보유) 중이면 알림.
  # 프론트는 이 신호를 받으면 라이브페이지 대신 읽기전용 뷰어로 라우팅한다.
  def notify_if_recording_in_progress(meeting)
    return unless meeting.recording?
    return if RecordingLock.holder(@meeting_id).nil?

    transmit({ "type" => "recording_in_progress", "meeting_id" => @meeting_id })
  end

  # 다른 기기가 이미 녹음 중일 때: viewer로 강등하고 1회만 거부 알림.
  def deny_recording
    @role = ROLE_VIEWER
    return if @recording_denied_notified

    @recording_denied_notified = true
    transmit({ "type" => "recording_denied", "meeting_id" => @meeting_id })
  end

  # 구독 권한 결정: owner / viewer / nil(거부)
  # admin 유저는 모든 회의에 owner 권한으로 접근 가능 (관리/모니터링 목적) — 단 남의 개인
  # 프로젝트(personal=true, 소유자 ≠ current_user) 소속 회의는 제외(project_id 없으면 override 유지).
  # 읽기 가시성이 있는 프로젝트 멤버는 viewer(읽기전용 뷰어의 실시간 수신용) —
  # MeetingLookup#authorize_meeting_read! 와 동일 판정(멤버십 && shared_visible?).
  def determine_role(meeting)
    return ROLE_OWNER if current_user.respond_to?(:admin?) && current_user.admin? && !meeting.project&.blocks_admin_override?(current_user)
    return ROLE_OWNER if meeting.owner?(current_user)
    return ROLE_VIEWER if project_member?(meeting) && meeting.shared_visible?

    nil
  end

  # MeetingLookup#project_member? 와 동일 판정. project_id 없으면 false(과도기 안전).
  def project_member?(meeting)
    meeting.project_id && ProjectMembership.exists?(project_id: meeting.project_id, user_id: current_user.id)
  end
end
