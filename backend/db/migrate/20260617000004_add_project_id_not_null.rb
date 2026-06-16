class AddProjectIdNotNull < ActiveRecord::Migration[8.1]
  # DATA-SAFETY (SQLite): change_column_null also rebuilds the table (create/copy/DROP/
  # rename). DROPping the old `meetings` fires ON DELETE CASCADE → transcripts/summaries/
  # chat_messages, and rebuilding `folders` SET NULLs meetings.folder_id. The same PRAGMA-
  # is-a-no-op-in-a-transaction problem applies here, so we mirror the fix from
  # 20260617000001: disable_ddl_transaction! + explicit FK-off around the rebuilds.
  disable_ddl_transaction!

  def up
    %w[meetings folders tags].each do |t|
      nulls = select_value("SELECT COUNT(*) FROM #{t} WHERE project_id IS NULL").to_i
      if nulls.positive?
        raise "#{t}: project_id NULL #{nulls}건 — 백필 미완. NOT NULL 중단(무변경)."
      end
    end
    safe_fk_off do
      change_column_null :meetings, :project_id, false
      change_column_null :folders, :project_id, false
      change_column_null :tags, :project_id, false
    end
  end

  def down
    safe_fk_off do
      change_column_null :meetings, :project_id, true
      change_column_null :folders, :project_id, true
      change_column_null :tags, :project_id, true
    end
  end

  private

  # Run the block with SQLite FK enforcement OFF, restoring the prior setting after.
  # Must be called OUTSIDE any transaction (hence disable_ddl_transaction!), because
  # `PRAGMA foreign_keys` cannot change while a transaction is active.
  def safe_fk_off
    return yield unless connection.adapter_name.casecmp?("SQLite")

    fk = connection.query_value("PRAGMA foreign_keys")
    connection.execute("PRAGMA foreign_keys = OFF")
    yield
  ensure
    connection.execute("PRAGMA foreign_keys = ON") if fk.to_s == "1"
  end
end
