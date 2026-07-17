# users.role CHECK 제약(chk_users_role)을 admin/member → admin/manager/member 로 넓힌다.
# 시스템 역할 3단계(admin/manager/member) 확장의 첫 단계 — 컬럼·데이터는 그대로, 허용값만 확장한다
# (20260615000006_add_check_constraints_for_enum_columns 가 만든 제약을 대체).
# 반드시 이 마이그레이션이 먼저 적용된 뒤 20260717000007(role 데이터 백필)이 실행되어야 한다 —
# 순서가 바뀌면 백필의 UPDATE users SET role='manager' 가 구 제약에 막혀 실패한다.
#
# ⚠️ SQLite 주의(데이터 유실 사고 방지 — sqlite-migration-cascade-hazard 참고, 2026-07-16 프로덕션 사고,
# db/migrate/20260716000001_drop_meeting_live_share.rb 의 방어 패턴을 그대로 따른다):
# add_check_constraint/remove_check_constraint 는 SQLite 에서 ALTER TABLE 로 직접 지원되지 않아
# 테이블 재구성(임시 테이블 생성→복사→원본 DROP→rename)을 유발한다. project_memberships.user_id 가
# users 를 ON DELETE CASCADE 로 참조하므로, 원본 users DROP 순간 project_memberships 전량이 연쇄
# 삭제될 위험이 있다(과거 remove_column이 transcripts/summaries를 전량 삭제한 사고와 동일 패턴).
# Rails 는 재구성 중 PRAGMA foreign_keys=OFF 로 이를 막지만, 마이그레이션이 DDL 트랜잭션 안에서
# 돌면 SQLite 는 트랜잭션 내 PRAGMA foreign_keys 를 무시해 방어가 무력화된다. 대응 3단:
#   1) disable_ddl_transaction! 로 트랜잭션을 끈다.
#   2) without_foreign_keys 로 파괴적 구간 동안 PRAGMA foreign_keys=OFF/ON 을 명시한다.
#   3) 그래도 못 믿는다 — users 를 참조하는 자식 테이블들의 행 수를 재구성 전/후로 세어 비교하고,
#      하나라도 달라지면 raise 해서 마이그레이션을 실패시킨다(자동 롤백은 유실을 못 되돌리므로,
#      "조용히 유실된 채 배포가 성공"하는 대신 즉시 배포를 중단시켜 백업 복구로 넘기는 것이 목적).
#
# 배포 전 필수: production.sqlite3 백업 + integrity_check. 배포 순서: 이 마이그레이션(스키마) →
# 20260717000007(데이터 백필). 배포 후에도 project_memberships/users 등 행 수 스팟체크 권장.
class WidenUsersRoleCheckConstraint < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  # users 를 FK로 참조하는 테이블 전체(ON DELETE CASCADE 대상인 project_memberships 포함) — 재구성
  # 전후 행 수가 하나라도 달라지면 CASCADE 유실로 간주한다.
  USERS_CHILD_TABLES = %w[project_memberships chat_messages domain_files meeting_contacts meetings projects].freeze

  def up
    without_foreign_keys do
      verify_no_row_loss do
        remove_check_constraint :users, name: "chk_users_role"
        add_check_constraint :users, "role IN ('admin','manager','member')", name: "chk_users_role"
      end
    end
  end

  def down
    without_foreign_keys do
      verify_no_row_loss do
        remove_check_constraint :users, name: "chk_users_role"
        add_check_constraint :users, "role IN ('admin','member')", name: "chk_users_role"
      end
    end
  end

  private

  # SQLite 에서만 유효한 방어. 트랜잭션 밖(disable_ddl_transaction!)이라 PRAGMA 가 실제로 적용된다.
  # 다른 어댑터(PostgreSQL 등)는 제약 변경이 테이블 재구성을 하지 않으므로 그대로 실행한다.
  def without_foreign_keys
    sqlite = connection.adapter_name.match?(/sqlite/i)
    connection.execute("PRAGMA foreign_keys = OFF") if sqlite
    yield
  ensure
    connection.execute("PRAGMA foreign_keys = ON") if sqlite
  end

  # 재구성 전/후 users 자식 테이블 행 수를 비교하는 무결성 자가검증. 하나라도 달라지면 raise 해서
  # 마이그레이션을 실패시킨다 — 이미 유실된 데이터는 되돌릴 수 없으므로, 조용히 성공하는 대신
  # 배포를 즉시 멈춰 백업 복구로 넘기는 것이 목적이다.
  def verify_no_row_loss
    before_counts = child_row_counts
    yield
    after_counts = child_row_counts

    changed = USERS_CHILD_TABLES.select { |t| before_counts[t] != after_counts[t] }
    return if changed.empty?

    details = changed.map { |t| "#{t}: #{before_counts[t]} → #{after_counts[t]}" }.join(", ")
    raise "CASCADE 유실 의심: users 테이블 재구성 중 자식 테이블 행 수가 변경됨(#{details}). " \
          "마이그레이션을 중단합니다 — 백업에서 복구 후 원인을 확인하세요."
  end

  def child_row_counts
    USERS_CHILD_TABLES.each_with_object({}) do |table, counts|
      counts[table] = connection.select_value("SELECT COUNT(*) FROM #{table}").to_i
    end
  end
end
