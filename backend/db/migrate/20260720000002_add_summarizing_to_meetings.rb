class AddSummarizingToMeetings < ActiveRecord::Migration[8.1]
  # 요약(regenerate/summarize/final/realtime) 진행 중 상태를 회의 모델에 영속화한다.
  # 회의 상세 배지뿐 아니라 회의목록(StatusBadge)에서도 새로고침·페이지 이탈 후에도
  # "요약중" 상태를 유지하기 위한 컬럼. MeetingSummarizationJob 의 시작/종료 브로드캐스트
  # 지점에서 record_summary_start!/record_summary_finished! 로 토글된다.
  # 단순 add_column 이라 disable_ddl_transaction! 불필요 (참조: AddSummaryErrorToMeetings).
  def change
    add_column :meetings, :summarizing, :boolean, null: false, default: false
    add_column :meetings, :summarization_started_at, :datetime, null: true
    # 인덱스 미추가 — summarizing 필드는 표시 전용(meeting_json 노출)이지 목록 필터 키가
    # 아니며, true 행이 극소수라 비-부분 인덱스는 쿼리 플래너에 무의미하다. 필요해지면
    # 그때 부분 인덱스(where: "summarizing = 1")로 추가한다.
  end
end
