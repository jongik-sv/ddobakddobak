class AddDiarizationThresholdToMeetings < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :diarization_threshold, :float, null: true
  end
end
