# 라이브 공유/참여(6자리 공유코드 · participant · host 위임/승격) 서브시스템 제거.
# meetings.shared(프로젝트 멤버 가시성 플래그)와는 별개 기능 — 그 컬럼은 유지한다.
#
# ⚠️ SQLite 주의(데이터 유실 사고 방지): remove_column 은 인덱스가 걸린 컬럼일 때
# 테이블 12-step 재구성(임시 테이블 생성→복사→원본 DROP→rename)을 유발한다. 이때
# transcripts/summaries 등 meetings 를 ON DELETE CASCADE 로 참조하는 자식 테이블이
# 원본 meetings DROP 순간 연쇄 삭제된다. Rails 는 재구성 중 PRAGMA foreign_keys=OFF 로
# 이를 막지만, 마이그레이션이 DDL 트랜잭션 안에서 돌면 SQLite 는 트랜잭션 내 PRAGMA
# foreign_keys 를 무시하므로 방어가 무력화된다. => disable_ddl_transaction! 로 트랜잭션을
# 끄고, 파괴적 구간 동안 명시적으로 FK 를 꺼서 CASCADE 를 차단한다.
class DropMeetingLiveShare < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    without_foreign_keys do
      drop_table :meeting_participants

      remove_index  :meetings, name: "index_meetings_on_share_code", if_exists: true
      remove_column :meetings, :share_code
    end
  end

  # 구조만 복원한다(제거 시점의 schema 그대로). 삭제된 참여/공유코드 데이터는 되돌릴 수 없음.
  def down
    without_foreign_keys do
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

  private

  # SQLite 에서만 유효한 방어. 트랜잭션 밖(disable_ddl_transaction!)이라 PRAGMA 가 실제로 적용된다.
  # 다른 어댑터(PostgreSQL 등)는 remove_column 이 테이블 재구성을 하지 않으므로 그대로 실행한다.
  def without_foreign_keys
    sqlite = connection.adapter_name.match?(/sqlite/i)
    connection.execute("PRAGMA foreign_keys = OFF") if sqlite
    yield
  ensure
    connection.execute("PRAGMA foreign_keys = ON") if sqlite
  end
end
