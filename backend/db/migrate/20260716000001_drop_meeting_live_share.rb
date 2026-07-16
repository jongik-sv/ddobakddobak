# 라이브 공유/참여(6자리 공유코드 · participant · host 위임/승격) 서브시스템 제거.
# meetings.shared(프로젝트 멤버 가시성 플래그)와는 별개 기능 — 그 컬럼은 유지한다.
class DropMeetingLiveShare < ActiveRecord::Migration[8.1]
  def up
    drop_table :meeting_participants

    remove_index  :meetings, name: "index_meetings_on_share_code"
    remove_column :meetings, :share_code
  end

  # 구조만 복원한다(제거 시점의 schema 그대로). 삭제된 참여/공유코드 데이터는 되돌릴 수 없음.
  def down
    add_column :meetings, :share_code, :string
    add_index  :meetings, :share_code, unique: true, name: "index_meetings_on_share_code"

    create_table :meeting_participants do |t|
      t.datetime :host_disconnected_at
      t.datetime :joined_at, null: false
      t.datetime :left_at
      t.integer  :meeting_id, null: false
      t.string   :role, default: "viewer", null: false
      t.integer  :user_id, null: false
      t.timestamps

      t.index [ :meeting_id, :role ], name: "idx_participants_meeting_role"
      t.index [ :meeting_id, :user_id, :left_at ], name: "idx_participants_meeting_user_active"
      t.index [ :user_id ], name: "index_meeting_participants_on_user_id"
      t.check_constraint "role IN ('host','viewer')", name: "chk_meeting_participants_role"
    end

    add_foreign_key :meeting_participants, :meetings
    add_foreign_key :meeting_participants, :users
  end
end
