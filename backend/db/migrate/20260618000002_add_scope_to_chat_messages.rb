class AddScopeToChatMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction! # SQLite 테이블 재생성(change_column_null) — 과거 와이프 연산 클래스. DDL 트랜잭션 밖에서 가드.

  def up
    before = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i

    add_column :chat_messages, :scope_type, :string, null: false, default: "meeting"
    add_column :chat_messages, :scope_id,   :integer

    # 기존 행 백필: 모두 meeting scope.
    execute "UPDATE chat_messages SET scope_id = meeting_id WHERE scope_id IS NULL"

    change_column_null :chat_messages, :meeting_id, true

    add_index :chat_messages, [:scope_type, :scope_id, :user_id, :created_at],
              name: "index_chat_messages_on_scope_and_user"

    after = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i
    raise "ABORT: chat_messages row count changed #{before}->#{after} (데이터 손실 의심)" unless before == after
    raise "ABORT: scope_id 백필 누락" if exec_query("SELECT COUNT(*) AS c FROM chat_messages WHERE scope_id IS NULL").first["c"].to_i.positive?
  end

  def down
    execute "DELETE FROM chat_messages WHERE scope_type <> 'meeting'"
    remove_index :chat_messages, name: "index_chat_messages_on_scope_and_user"
    change_column_null :chat_messages, :meeting_id, false
    remove_column :chat_messages, :scope_id
    remove_column :chat_messages, :scope_type
  end
end
