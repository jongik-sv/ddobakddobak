class AddPreviousMeetingToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :previous_meeting_id, :integer
    add_index :meetings, :previous_meeting_id
  end
end
