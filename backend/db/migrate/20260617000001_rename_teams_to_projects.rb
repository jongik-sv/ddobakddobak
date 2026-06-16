class RenameTeamsToProjects < ActiveRecord::Migration[8.1]
  # Phase 1: pure rename, behavior change 0.
  # Reality (per schema.rb at time of writing) — FKs that actually exist:
  #   meetings -> teams           (on_delete: :cascade)
  #   tags -> teams               (no cascade)
  #   team_memberships -> teams   (on_delete: :cascade)
  #   folders has NO FK to teams (only an index on team_id) -> we must NOT add one.
  # We re-add each FK with the SAME on_delete semantics to avoid any behavior change.
  def up
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

  def down
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
