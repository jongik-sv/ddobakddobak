class HostGracePeriodJob < ApplicationJob
  AUTO_PROMOTE_DELAY = 20.seconds # 10s grace + 20s = 30s total

  queue_as :default

  def perform(meeting_id:, user_id:, disconnected_at:)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.sharing?

    participant = meeting.host_participant
    return unless participant&.user_id == user_id
    return unless participant.host_disconnected_at.present?
    return unless participant.host_disconnected_at.iso8601(6) == disconnected_at

    remaining = meeting.active_participants.where.not(user_id: user_id)

    if remaining.empty?
      MeetingShareService.new.leave_meeting(meeting, participant.user)
      return
    end

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "host_claimable", disconnected_host_id: user_id }
    )

    HostAutoPromoteJob.set(wait: AUTO_PROMOTE_DELAY).perform_later(
      meeting_id: meeting_id,
      user_id: user_id,
      disconnected_at: disconnected_at
    )
  end
end
