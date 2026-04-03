class CreateDecisions < ActiveRecord::Migration[8.1]
  def change
    create_table :decisions do |t|
      t.integer  :meeting_id,   null: false
      t.text     :content,      null: false
      t.text     :context
      t.datetime :decided_at
      t.text     :participants
      t.string   :status,       null: false, default: "active"
      t.boolean  :ai_generated, null: false, default: false

      t.timestamps null: false
    end

    add_index :decisions, :meeting_id
    add_index :decisions, :status
  end
end
