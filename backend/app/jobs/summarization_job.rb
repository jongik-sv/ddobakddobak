class SummarizationJob < ApplicationJob
  queue_as :summarization

  # 5분 cron으로 호출됨 (config/recurring.yml).
  # 각 recording 회의별로 MeetingSummarizationJob을 개별 enqueue하여 병렬 처리한다.
  def perform
    Meeting.recording.ids.each do |meeting_id|
      MeetingSummarizationJob.perform_later(meeting_id, type: "realtime")
    end
  end
end
