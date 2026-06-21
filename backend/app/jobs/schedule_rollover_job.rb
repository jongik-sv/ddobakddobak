class ScheduleRolloverJob < ApplicationJob
  queue_as :default

  # 1분 cron 으로 호출됨 (config/recurring.yml).
  # 시간이 지난(놓친) 반복 시리즈 중 미래 successor 가 없는 것에 대해 다음 occurrence 를
  # 1개씩 예약한다. materialize_next_occurrence! 의 멱등 가드(미래 형제 존재 시 no-op)가
  # 매분 실행해도 중복 생성을 막는다. 놓친 원본은 pending 으로 남겨 "놓친 예약" 목록에 계속 노출.
  def perform
    Meeting.missed_scheduled.where.not(recurrence_rule: nil).find_each do |meeting|
      meeting.materialize_next_occurrence!
    end
  end
end
