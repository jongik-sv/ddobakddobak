class AddAttendeesToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :attendees, :text
  end
end
