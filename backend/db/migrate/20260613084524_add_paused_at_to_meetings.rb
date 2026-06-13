class AddPausedAtToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :paused_at, :datetime
  end
end
