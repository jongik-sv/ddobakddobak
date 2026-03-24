class AddSourceAndProgressToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :source, :string, default: "live", null: false
    add_column :meetings, :transcription_progress, :integer, default: 0, null: false
  end
end
