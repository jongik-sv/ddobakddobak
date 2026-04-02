class MeetingShareService
  MAX_PARTICIPANTS = 20

  class NotHostError < StandardError; end
  class InvalidShareCodeError < StandardError; end
  class ParticipantLimitError < StandardError; end
  class InvalidTargetError < StandardError; end

  # 공유 코드 생성 (멱등) — 이미 공유 중이면 기존 코드 반환
  def generate_share_code(meeting, user)
    if meeting.sharing?
      return { share_code: meeting.share_code, participants: serialize_active_participants(meeting) }
    end

    code = generate_unique_code
    meeting.update!(share_code: code)

    # 호출자를 host participant로 등록
    meeting.meeting_participants.create!(
      user: user,
      role: "host",
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
  end

  # 공유 코드로 회의 참여 (멱등)
  def join_meeting(share_code, user)
    meeting = Meeting.find_by(share_code: share_code)
    raise InvalidShareCodeError, "Invalid share code" unless meeting

    # 이미 참여 중이면 기존 정보 반환
    existing = meeting.active_participants.find_by(user: user)
    return { meeting: meeting, participant: existing } if existing

    # 참여자 수 제한 체크
    if meeting.active_participants.count >= MAX_PARTICIPANTS
      raise ParticipantLimitError, "Maximum #{MAX_PARTICIPANTS} participants allowed"
    end

    participant = meeting.meeting_participants.create!(
      user: user,
      role: "viewer",
      joined_at: Time.current
    )

    { meeting: meeting, participant: participant }
  end

  # 호스트 위임
  def transfer_host(meeting, current_user, target_user_id)
    ensure_host!(meeting, current_user)

    target_participant = meeting.active_participants.find_by(user_id: target_user_id)
    raise InvalidTargetError, "Target user is not an active participant" unless target_participant

    ActiveRecord::Base.transaction do
      meeting.host_participant.update!(role: "viewer")
      target_participant.update!(role: "host")
    end

    { participants: serialize_active_participants(meeting) }
  end

  # 회의 나가기 — left_at 설정, 호스트가 나가면 자동 위임
  def leave_meeting(meeting, user)
    participant = meeting.active_participants.find_by(user: user)
    return unless participant

    ActiveRecord::Base.transaction do
      was_host = participant.role == "host"
      participant.update!(left_at: Time.current)

      if was_host
        auto_delegate_host!(meeting)
      end

      # 활성 참여자가 없으면 공유 코드 제거
      if meeting.active_participants.reload.empty?
        meeting.update!(share_code: nil)
      end
    end
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
  end

  # 가장 먼저 참여한 활성 viewer에게 호스트를 자동 위임
  def auto_delegate_host!(meeting)
    next_host = meeting.active_participants.where(role: "viewer").order(:joined_at).first
    next_host&.update!(role: "host")
  end

  # N+1 방지를 위해 includes(:user) 적용, MeetingParticipant#as_summary로 직렬화 일원화
  def serialize_active_participants(meeting)
    meeting.active_participants.reload.includes(:user).map(&:as_summary)
  end
end
