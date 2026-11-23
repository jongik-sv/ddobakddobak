class CreateSttTermMoveLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :stt_term_move_logs do |t|
      t.references :actor, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
      t.text :moves
      t.text :result
      t.timestamps
    end
  end
end
