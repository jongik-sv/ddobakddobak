class CreateActionItems < ActiveRecord::Migration[8.1]
  def change
    create_table :action_items do |t|
      t.integer :meeting_id,   null: false
      t.integer :assignee_id
      t.text    :content,      null: false
      t.date    :due_date
      t.string  :status,       null: false, default: "todo"
      t.boolean :ai_generated, null: false, default: false

      t.timestamps null: false
    end

    add_index :action_items, :meeting_id
    add_index :action_items, :assignee_id
  end
end
