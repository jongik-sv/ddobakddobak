class ReassignOrphanCreatorsAndAddCreatorFks < ActiveRecord::Migration[8.1]
  # #11 3단계: meetings.created_by_id / teams.created_by_id → users FK.
  #
  # created_by_id 는 NOT NULL 필수 컬럼이라 nullify 불가. 창작자 user가 삭제되어
  # dangling된 실데이터(회의/팀)를 보존하기 위해, orphan created_by_id 를 안정적인
  # fallback 관리자(desktop@local 우선)로 재할당한 뒤 FK를 건다.
  #
  # on_delete 미지정 = restrict(기본). 기존 meeting_contacts→users(created_by_id) FK와
  # 동일 정책. 현재 앱에 user 삭제 플로우가 없어 정상 경로 동작 변경 없음.

  def up
    fallback = User.find_by(email: User::LOCAL_EMAIL) ||
               User.where(role: "admin").order(:id).first ||
               User.order(:id).first

    orphan_meetings = Meeting.where("created_by_id NOT IN (SELECT id FROM users)")
    orphan_teams_count = select_value("SELECT COUNT(*) FROM teams WHERE created_by_id NOT IN (SELECT id FROM users)").to_i

    if orphan_meetings.exists? || orphan_teams_count.positive?
      raise "No fallback user available for orphan creator reassignment" if fallback.nil?
      say_with_time "Reassigning orphan creators to #{fallback.email} (id=#{fallback.id})" do
        orphan_meetings.update_all(created_by_id: fallback.id)
        execute("UPDATE teams SET created_by_id = #{fallback.id} WHERE created_by_id NOT IN (SELECT id FROM users)")
      end
    end

    add_foreign_key :meetings, :users, column: :created_by_id
    add_foreign_key :teams, :users, column: :created_by_id
  end

  def down
    remove_foreign_key :meetings, :users, column: :created_by_id
    remove_foreign_key :teams, :users, column: :created_by_id
    # 재할당은 비가역(원래 창작자 user가 이미 부재) — down에서 복원하지 않는다.
  end
end
