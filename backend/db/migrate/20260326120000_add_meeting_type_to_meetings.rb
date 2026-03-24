class AddMeetingTypeToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :meeting_type, :string, default: "general", null: false
  end
end
