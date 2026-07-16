class SummarizationJob < ApplicationJob
  queue_as :summarization

  # 1분 cron으로 호출됨 (config/recurring.yml).
  # 각 recording 회의별로 MeetingSummarizationJob을 개별 enqueue하여 병렬 처리한다.
  # 일시정지(paused_at 설정)된 회의는 제외 — 클라이언트 일시정지 중 자동 요약 금지.
  # summary_interval_sec 이 0(안함)인 회의도 제외 — 회의별 자동 요약 주기 설정 반영.
  def perform
    Meeting.recording.where(paused_at: nil).where.not(summary_interval_sec: 0).ids.each do |meeting_id|
      MeetingSummarizationJob.perform_later(meeting_id, type: "realtime")
    end
  end
end
