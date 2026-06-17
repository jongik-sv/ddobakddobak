class AddTrashColumns < ActiveRecord::Migration[7.1]
  def change
    %i[meetings folders projects].each do |table|
      add_column table, :deleted_at, :datetime
      add_column table, :deleted_by_id, :integer
      add_column table, :trash_group_id, :string
      add_column table, :trashed_as_root, :boolean, default: false, null: false
      add_index table, :deleted_at
      add_index table, :trash_group_id
    end
  end
end
