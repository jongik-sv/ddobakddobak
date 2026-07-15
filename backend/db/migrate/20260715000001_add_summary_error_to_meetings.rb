class AddSummaryErrorToMeetings < ActiveRecord::Migration[8.1]
  # 요약(LLM) 실패를 사용자에게 레포트하기 위한 영속 기록.
  # final 실패(ok:false 최종 처리·rescue·재enqueue 포기)만 기록한다 —
  # realtime transient 실패는 매분 cron이 재시도하므로 영속 기록하면 노이즈.
  # 성공 저장 시 두 컬럼을 클리어한다. 단순 add_column 이라 disable_ddl_transaction! 불필요.
  def change
    add_column :meetings, :summary_error_message, :text
    add_column :meetings, :summary_error_at, :datetime
  end
end
