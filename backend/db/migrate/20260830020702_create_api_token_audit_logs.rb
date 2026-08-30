class CreateApiTokenAuditLogs < ActiveRecord::Migration[8.1]
  # 외부 API 감사 로그. meeting_id는 의도적으로 FK를 걸지 않는다 — 회의가 삭제돼도 로그는 보존한다.
  def change
    create_table :api_token_audit_logs do |t|
      t.references :api_token, null: false, foreign_key: true
      t.string :action, null: false
      t.integer :meeting_id
      t.string :path
      t.string :ip

      t.datetime :created_at, null: false
    end

    add_index :api_token_audit_logs, [ :api_token_id, :created_at ]
  end
end
