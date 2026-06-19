class CreateTranscriptEmbeddings < ActiveRecord::Migration[8.1]
  def change
    create_table :transcript_embeddings do |t|
      t.integer :transcript_id, null: false
      t.integer :meeting_id, null: false
      t.string  :model_version, null: false
      t.integer :dim, null: false
      t.binary  :embedding, null: false
      t.timestamps
    end
    add_index :transcript_embeddings, :transcript_id, unique: true
    add_index :transcript_embeddings, [:meeting_id, :model_version]
    add_foreign_key :transcript_embeddings, :transcripts, on_delete: :cascade
  end
end
