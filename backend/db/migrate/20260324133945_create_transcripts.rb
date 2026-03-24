class CreateTranscripts < ActiveRecord::Migration[8.1]
  def change
    create_table :transcripts do |t|
      t.integer :meeting_id,     null: false
      t.string  :speaker_label,  null: false
      t.text    :content,        null: false
      t.integer :started_at_ms,  null: false
      t.integer :ended_at_ms,    null: false
      t.integer :sequence_number, null: false

      t.datetime :created_at, null: false
    end

    add_index :transcripts, [ :meeting_id, :sequence_number ]
  end
end
