class ChatChannel < ApplicationCable::Channel
  def subscribed
    meeting = Meeting.find_by(id: params[:meeting_id])
    return reject unless meeting && readable?(meeting)

    stream_from "meeting_#{meeting.id}_chat_#{current_user.id}"
  end

  private

  # MeetingLookup#authorize_meeting_read! 와 동일 규칙:
  # admin / 소유자(created_by_id) / 공유 가시(shared_visible?) / active participant.
  # 채널엔 controller 헬퍼가 없으므로 모델 메서드로 동일 판정을 표현한다.
  def readable?(meeting)
    return true if current_user.respond_to?(:admin?) && current_user.admin?
    return true if meeting.owner?(current_user)
    return true if meeting.shared_visible?

    meeting.active_participants.exists?(user_id: current_user.id)
  end
end
