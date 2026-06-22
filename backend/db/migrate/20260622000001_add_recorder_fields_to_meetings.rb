class AddRecorderFieldsToMeetings < ActiveRecord::Migration[8.1]
  # 클라이언트 식별 토대 + 비정상 종료 녹음 자동 종결:
  # - recording_client_id/platform: B/C 토대·감사(녹음 시작 시 도장).
  # - recorder_heartbeat_at: recorder presence 신호(하트비트). 부재로 stale 판정.
  # 단순 add_column 이므로 테이블 재생성이 아니고 disable_ddl_transaction! 불필요.
  def change
    add_column :meetings, :recording_client_id, :string
    add_column :meetings, :recording_client_platform, :string
    add_column :meetings, :recorder_heartbeat_at, :datetime
  end
end
