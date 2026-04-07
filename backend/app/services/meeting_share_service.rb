class MeetingShareService
  MAX_PARTICIPANTS = 20

  class NotHostError < StandardError; end
  class InvalidShareCodeError < StandardError; end
  class ParticipantLimitError < StandardError; end
  class InvalidTargetError < StandardError; end

  # 공유 코드 생성 (멱등) — 이미 공유 중이면 기존 코드 반환
  def generate_share_code(meeting, user)
    raise NotHostError, "Only the meeting creator can share" unless meeting.owner?(user)

    if meeting.sharing?
      return { share_code: meeting.share_code, participants: serialize_active_participants(meeting) }
    end

    code = generate_unique_code
    meeting.update!(share_code: code)

    # 호출자를 host participant로 등록
    meeting.meeting_participants.create!(
      user: user,
      role: MeetingParticipant::ROLE_HOST,
      joined_at: Time.current
    )

    { share_code: code, participants: serialize_active_participants(meeting) }
  end

  # 공유 중지 — share_code를 nil로, 모든 활성 참여자의 left_at 설정
  def revoke_share_code(meeting, user)
    ensure_host!(meeting, user)

    ActiveRecord::Base.transaction do
      meeting.active_participants.update_all(left_at: Time.current)
      meeting.update!(share_code: nil)
    end

    # 개별 participant_left 대신 단일 sharing_stopped 이벤트로 클라이언트 일괄 정리
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "sharing_stopped" }
    )
  end

  # 공유 코드로 회의 참여 (멱등)
  def join_meeting(share_code, user)
    meeting = Meeting.find_by(share_code: share_code)
    raise InvalidShareCodeError, "Invalid share code" unless meeting

    meeting.with_lock do
      existing = meeting.active_participants.find_by(user: user)
      return { meeting: meeting, participant: existing } if existing

      if meeting.active_participants.count >= MAX_PARTICIPANTS
        raise ParticipantLimitError, "Maximum #{MAX_PARTICIPANTS} participants allowed"
      end

      # 활성 호스트가 없으면 입장자를 host로 승격
      role = meeting.host_participant.nil? ? MeetingParticipant::ROLE_HOST : MeetingParticipant::ROLE_VIEWER

      participant = meeting.meeting_participants.create!(
        user: user,
        role: role,
        joined_at: Time.current
      )

      broadcast_host_transferred(meeting, user) if role == MeetingParticipant::ROLE_HOST

      { meeting: meeting, participant: participant }
    end
  end

  # 호스트 위임
  def transfer_host(meeting, current_user, target_user_id)
    current_host = ensure_host!(meeting, current_user)

    target_participant = meeting.active_participants.find_by(user_id: target_user_id)
    raise InvalidTargetError, "Target user is not an active participant" unless target_participant

    ActiveRecord::Base.transaction do
      current_host.update!(role: MeetingParticipant::ROLE_VIEWER)
      target_participant.update!(role: MeetingParticipant::ROLE_HOST)
    end

    broadcast_host_transferred(meeting, target_participant.user)

    { participants: serialize_active_participants(meeting) }
  end

  # viewer가 호스트를 요청 (호스트 끊김 상태에서만 가능)
  def claim_host(meeting, user)
    meeting.with_lock do
      current_host = meeting.host_participant
      raise NotHostError, "Host is still connected" if current_host && current_host.host_disconnected_at.nil?

      claimer = meeting.active_participants.find_by(user_id: user.id, role: MeetingParticipant::ROLE_VIEWER)
      raise InvalidTargetError, "User is not an active viewer" unless claimer

      ActiveRecord::Base.transaction do
        current_host&.update!(left_at: Time.current)
        claimer.update!(role: MeetingParticipant::ROLE_HOST)
      end

      broadcast_host_transferred(meeting, claimer.user)
      { participants: serialize_active_participants(meeting) }
    end
  end

  # 회의 나가기 — left_at 설정, 호스트가 나가면 자동 위임
  def leave_meeting(meeting, user)
    participant = meeting.active_participants.find_by(user: user)
    return unless participant

    ActiveRecord::Base.transaction do
      was_host = participant.role == MeetingParticipant::ROLE_HOST
      participant.update!(left_at: Time.current)

      remaining = meeting.active_participants.reload
      auto_delegate_host!(meeting, remaining) if was_host
      meeting.update!(share_code: nil) if remaining.empty?
    end
  end

  def serialize_active_participants(meeting)
    meeting.active_participants.reload.includes(:user).map(&:as_summary)
  end

  private

  def generate_unique_code
    loop do
      code = SecureRandom.alphanumeric(6).upcase
      return code unless Meeting.exists?(share_code: code)
    end
  end

  def ensure_host!(meeting, user)
    host = meeting.host_participant
    raise NotHostError, "Only the host can perform this action" unless host&.user_id == user.id
    host
  end

  def auto_delegate_host!(meeting, remaining = nil)
    remaining ||= meeting.active_participants.reload
    next_host = remaining.where(role: MeetingParticipant::ROLE_VIEWER).order(:joined_at).first
    return unless next_host

    next_host.update!(role: "host")
    broadcast_host_transferred(meeting, next_host.user)
  end

  def broadcast_host_transferred(meeting, new_host_user)
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      {
        type: "host_transferred",
        new_host_id: new_host_user.id,
        new_host_name: new_host_user.name
      }
    )
  end

end
