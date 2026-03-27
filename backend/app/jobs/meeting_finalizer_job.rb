class MeetingFinalizerJob < ApplicationJob
  queue_as :summarization

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    MeetingFinalizerService.new(meeting).call
  end
end
