class AddProjectIdNotNull < ActiveRecord::Migration[8.1]
  def up
    %w[meetings folders tags].each do |t|
      nulls = select_value("SELECT COUNT(*) FROM #{t} WHERE project_id IS NULL").to_i
      if nulls.positive?
        raise "#{t}: project_id NULL #{nulls}건 — 백필 미완. NOT NULL 중단(무변경)."
      end
    end
    change_column_null :meetings, :project_id, false
    change_column_null :folders, :project_id, false
    change_column_null :tags, :project_id, false
  end

  def down
    change_column_null :meetings, :project_id, true
    change_column_null :folders, :project_id, true
    change_column_null :tags, :project_id, true
  end
end
