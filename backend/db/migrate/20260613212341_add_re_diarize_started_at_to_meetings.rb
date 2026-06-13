class AddReDiarizeStartedAtToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :re_diarize_started_at, :datetime
  end
end
