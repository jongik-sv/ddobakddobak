class AddAudioSourceToTranscripts < ActiveRecord::Migration[8.1]
  def change
    add_column :transcripts, :audio_source, :string, default: "mic", null: false
  end
end
