class HostAutoPromoteJob < ApplicationJob
  queue_as :default

  def perform(meeting_id:, user_id:, disconnected_at:)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.sharing?

    # 누군가 이미 claim 했는지 확인
    current_host = meeting.host_participant
    return if current_host && current_host.user_id != user_id
    return if current_host&.host_disconnected_at.nil?

    # disconnected_at 타임스탬프 일치 확인 (재접속 후 재끊김 방지)
    return unless current_host.host_disconnected_at.iso8601(6) == disconnected_at

    # leave_meeting이 auto_delegate_host!를 호출하여 자동 승격
    MeetingShareService.new.leave_meeting(meeting, current_host.user)
  end
end
