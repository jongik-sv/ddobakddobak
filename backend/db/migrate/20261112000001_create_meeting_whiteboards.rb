class CreateMeetingWhiteboards < ActiveRecord::Migration[8.1]
  # 새 테이블만 만든다(기존 테이블 재생성 없음 — SQLite FK/CASCADE 함정 회피).
  def change
    create_table :meeting_whiteboards do |t|
      t.references :meeting, null: false, foreign_key: true, index: { unique: true }
      t.string :status, null: false, default: "running"
      t.string :digest
      t.string :prompt_version
      t.text :board_json
      t.string :error_kind
      t.text :error_message
      # 요청 사용자 삭제 시 행은 남기고 NULL 로(admin 사용자 삭제 500 방지).
      t.references :requested_by, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
      # 실행 세대 토큰 — 재enqueue 시 갱신, 잡 결과는 토큰이 같을 때만 반영(CAS).
      t.string :run_token
      t.timestamps
    end
  end
end
