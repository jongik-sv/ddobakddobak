class AddSpeakerNameToTranscripts < ActiveRecord::Migration[8.1]
  def change
    add_column :transcripts, :speaker_name, :string
  end
end
