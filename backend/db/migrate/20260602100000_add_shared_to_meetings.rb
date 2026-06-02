class AddSharedToMeetings < ActiveRecord::Migration[8.0]
  # 회의 공유/비공개 (#6). 기본값 true → 신규/기존 회의 모두 공유 상태.
  # default: true + null: false 로 add_column 하면 기존 모든 행이 true로 백필된다
  # (요청: "지금 있는 회의들 모두 공유 상태로 마이그레이션").
  def change
    add_column :meetings, :shared, :boolean, default: true, null: false
    add_index :meetings, [ :created_by_id, :shared ]
  end
end
