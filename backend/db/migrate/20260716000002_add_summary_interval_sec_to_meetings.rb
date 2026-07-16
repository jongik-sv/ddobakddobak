# 회의별 자동 요약 주기(초). 0 = 자동 요약 안 함. 기본값 180은 config.yaml
# summary.default_interval_sec 와 일치한다. SummarizationJob cron 이 0 회의를 제외한다.
class AddSummaryIntervalSecToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :summary_interval_sec, :integer, default: 180, null: false
  end
end
