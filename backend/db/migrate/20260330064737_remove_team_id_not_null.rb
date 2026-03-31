class RemoveTeamIdNotNull < ActiveRecord::Migration[8.1]
  def change
    change_column_null :meetings, :team_id, true
    change_column_null :folders, :team_id, true
    change_column_null :tags, :team_id, true
  end
end
