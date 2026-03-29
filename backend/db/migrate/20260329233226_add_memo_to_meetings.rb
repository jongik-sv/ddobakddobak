class AddMemoToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :memo, :text
  end
end
