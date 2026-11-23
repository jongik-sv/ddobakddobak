class CreateSttTermLearningItems < ActiveRecord::Migration[8.1]
  def change
    create_table :stt_term_learning_items do |t|
      t.references :run, null: false, foreign_key: { to_table: :stt_term_learning_runs, on_delete: :cascade }
      t.string :wrong, null: false
      t.string :correct, null: false
      t.string :wrong_key, null: false
      t.string :correct_key, null: false
      t.string :category
      t.string :definition
      t.float :confidence
      t.string :source, null: false
      t.string :verdict, null: false
      t.string :reason
      t.references :domain_file, null: true, foreign_key: { on_delete: :nullify }
      t.string :level_owner_type
      t.bigint :level_owner_id
      t.text :change
      t.references :misrecognition, null: true, foreign_key: { to_table: :stt_misrecognitions, on_delete: :nullify }
      t.string :revert_result
      t.timestamps
    end
    add_index :stt_term_learning_items, [ :domain_file_id, :correct_key ]
  end
end
