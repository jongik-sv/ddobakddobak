class CreateSttTermLearningRuns < ActiveRecord::Migration[8.1]
  def change
    create_table :stt_term_learning_runs do |t|
      t.references :meeting, null: false, foreign_key: { on_delete: :cascade }
      t.references :summary, null: true, foreign_key: { on_delete: :nullify }
      t.string :trigger, null: false
      t.string :status, null: false, default: "queued"
      t.text :ai_text
      t.text :human_text
      t.text :transcript_text
      t.string :input_digest
      t.string :llm_model
      t.string :llm_skipped_reason
      t.text :error
      t.datetime :started_at
      t.datetime :finished_at
      t.timestamps
    end
    add_index :stt_term_learning_runs, [ :meeting_id, :input_digest ]
    add_index :stt_term_learning_runs, :status
  end
end
