class CentralizeMeetingTemplates < ActiveRecord::Migration[8.1]
  def up
    remove_foreign_key :meeting_templates, :users
    remove_index :meeting_templates, :user_id, if_exists: true
    remove_column :meeting_templates, :user_id
  end

  def down
    add_column :meeting_templates, :user_id, :integer
    add_index :meeting_templates, :user_id
    add_foreign_key :meeting_templates, :users
  end
end
