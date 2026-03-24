class AddAppliedToMinutesToTranscripts < ActiveRecord::Migration[8.1]
  def change
    add_column :transcripts, :applied_to_minutes, :boolean, default: false, null: false
  end
end
