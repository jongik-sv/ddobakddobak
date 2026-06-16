class RenameTeamsToProjects < ActiveRecord::Migration[8.1]
  # Phase 1: pure rename, behavior change 0.
  # Reality (per schema.rb at time of writing) — FKs that actually exist:
  #   meetings -> teams           (on_delete: :cascade)
  #   tags -> teams               (no cascade)
  #   team_memberships -> teams   (on_delete: :cascade)
  #   folders has NO FK to teams (only an index on team_id) -> we must NOT add one.
  # We re-add each FK with the SAME on_delete semantics to avoid any behavior change.
  #
  # DATA-SAFETY (SQLite): add/remove_foreign_key and rename_column rebuild the table
  # (create new / copy / DROP old / rename). DROPping the old `meetings` table fires
  # ON DELETE CASCADE → wipes transcripts/summaries/chat_messages, and rebuilding
  # `folders` SET NULLs meetings.folder_id. Rails' alter_table tries to guard this with
  # `PRAGMA foreign_keys = OFF`, but that PRAGMA is a NO-OP while a transaction is open —
  # and migrations run inside a DDL transaction, so the guard never takes effect and the
  # cascade fires. Fix: disable_ddl_transaction! so no outer txn is open when Rails
  # (and our own safe_fk_off) sets the PRAGMA, and explicitly turn FK enforcement off
  # around the whole body.
  disable_ddl_transaction!

  def up
    safe_fk_off do
      remove_foreign_key :meetings, :teams, if_exists: true
      remove_foreign_key :tags, :teams, if_exists: true
      remove_foreign_key :team_memberships, :teams, if_exists: true

      rename_table :teams, :projects
      rename_table :team_memberships, :project_memberships

      rename_column :meetings, :team_id, :project_id
      rename_column :folders, :team_id, :project_id
      rename_column :tags, :team_id, :project_id
      rename_column :project_memberships, :team_id, :project_id

      add_foreign_key :meetings, :projects, column: :project_id, on_delete: :cascade
      add_foreign_key :tags, :projects, column: :project_id
      add_foreign_key :project_memberships, :projects, on_delete: :cascade
    end
  end

  def down
    safe_fk_off do
      remove_foreign_key :meetings, :projects, column: :project_id, if_exists: true
      remove_foreign_key :tags, :projects, column: :project_id, if_exists: true
      remove_foreign_key :project_memberships, :projects, if_exists: true

      rename_column :project_memberships, :project_id, :team_id
      rename_column :tags, :project_id, :team_id
      rename_column :folders, :project_id, :team_id
      rename_column :meetings, :project_id, :team_id

      rename_table :project_memberships, :team_memberships
      rename_table :projects, :teams

      add_foreign_key :meetings, :teams, on_delete: :cascade
      add_foreign_key :tags, :teams
      add_foreign_key :team_memberships, :teams, on_delete: :cascade
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
