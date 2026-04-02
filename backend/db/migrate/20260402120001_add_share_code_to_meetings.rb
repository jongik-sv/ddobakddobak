class AddShareCodeToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :share_code, :string
    add_index :meetings, :share_code, unique: true
  end
end
