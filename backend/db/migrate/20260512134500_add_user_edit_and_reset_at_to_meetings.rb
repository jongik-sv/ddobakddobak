class AddUserEditAndResetAtToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :last_user_edit_at, :datetime
    add_column :meetings, :last_reset_at, :datetime
  end
end
