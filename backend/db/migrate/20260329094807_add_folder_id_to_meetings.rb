class AddFolderIdToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :folder_id, :integer
    add_index  :meetings, :folder_id
  end
end
