class CreateSttMisrecognitions < ActiveRecord::Migration[8.1]
  def change
    create_table :stt_misrecognitions do |t|
      t.references :project, null: false, foreign_key: { on_delete: :cascade }
      t.string :wrong, null: false
      t.string :correct, null: false
      t.string :wrong_key, null: false
      t.string :correct_key, null: false
      t.string :status, null: false, default: "undecided"
      t.integer :hit_count, null: false, default: 0
      t.references :first_meeting, null: true, foreign_key: { to_table: :meetings, on_delete: :nullify }
      t.references :last_meeting, null: true, foreign_key: { to_table: :meetings, on_delete: :nullify }
      t.datetime :last_seen_at
      t.timestamps
    end
    add_index :stt_misrecognitions, [ :project_id, :wrong_key, :correct_key ], unique: true,
              name: "idx_stt_misrecognitions_unique_pair"
  end
end
