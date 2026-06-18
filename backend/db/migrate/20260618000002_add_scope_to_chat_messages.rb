class AddScopeToChatMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction! # SQLite 테이블 재생성(change_column_null) — 과거 와이프 연산 클래스. DDL 트랜잭션 밖에서 가드.

  def up
    before = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i

    add_column :chat_messages, :scope_type, :string, null: false, default: "meeting"
    add_column :chat_messages, :scope_id,   :integer

    # 기존 행 백필: 모두 meeting scope.
    execute "UPDATE chat_messages SET scope_id = meeting_id WHERE scope_id IS NULL"

    # change_column_null이 chat_messages를 재생성(create/copy/DROP/rename)한다. DROP 시
    # FK 강제(ON)면 부모/자식 cascade가 발동할 수 있어 20260617000004와 동일하게 FK-off로 감싼다.
    safe_fk_off do
      change_column_null :chat_messages, :meeting_id, true
    end

    add_index :chat_messages, [:scope_type, :scope_id, :user_id, :created_at],
              name: "index_chat_messages_on_scope_and_user"

    after = exec_query("SELECT COUNT(*) AS c FROM chat_messages").first["c"].to_i
    raise "ABORT: chat_messages row count changed #{before}->#{after} (데이터 손실 의심)" unless before == after
    raise "ABORT: scope_id 백필 누락" if exec_query("SELECT COUNT(*) AS c FROM chat_messages WHERE scope_id IS NULL").first["c"].to_i.positive?
  end

  def down
    execute "DELETE FROM chat_messages WHERE scope_type <> 'meeting'"
    remove_index :chat_messages, name: "index_chat_messages_on_scope_and_user"
    # meeting_id를 NOT NULL로 되돌린다. 위 DELETE 후에도 meeting scope 행에 meeting_id NULL이
    # 남아 있으면(과거 백필 누락 등) SQLite가 여기서 raise한다 — 의도된 안전장치.
    safe_fk_off do
      change_column_null :chat_messages, :meeting_id, false
    end
    remove_column :chat_messages, :scope_id
    remove_column :chat_messages, :scope_type
  end

  private

  # SQLite FK 강제를 OFF로 두고 블록 실행 후 원복. 트랜잭션 밖에서 호출해야 한다
  # (PRAGMA foreign_keys는 트랜잭션 활성 중 변경 불가 — 그래서 disable_ddl_transaction!).
  def safe_fk_off
    return yield unless connection.adapter_name.casecmp?("SQLite")

    fk = connection.query_value("PRAGMA foreign_keys")
    connection.execute("PRAGMA foreign_keys = OFF")
    yield
  ensure
    connection.execute("PRAGMA foreign_keys = ON") if fk.to_s == "1"
  end
end
