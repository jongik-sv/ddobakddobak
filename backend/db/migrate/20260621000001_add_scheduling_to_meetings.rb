class AddSchedulingToMeetings < ActiveRecord::Migration[8.0]
  # 예약 회의 자동 시작: 예약 시각·시작 방식·반복 규칙·놓침 닫기 시각을 meetings 에 추가한다.
  # 단순 add_column 이므로 테이블 재생성이 아니고 disable_ddl_transaction! 불필요
  # (SQLite FK 함정은 rename/FK 재생성 케이스에 한정).
  def change
    add_column :meetings, :scheduled_start_time, :datetime  # 예약 시각(UTC). null = 즉시 회의(기존).
    add_column :meetings, :auto_start_mode, :string         # "auto" | "manual". 예약 회의에만 의미.
    add_column :meetings, :recurrence_rule, :text           # JSON. null = 1회성.
    add_column :meetings, :schedule_dismissed_at, :datetime # 놓친 예약을 닫은 시각(목록에서 숨김).

    add_index :meetings, :scheduled_start_time # 스케줄러 조회용
  end
end
