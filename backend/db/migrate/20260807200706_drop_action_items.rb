class DropActionItems < ActiveRecord::Migration[8.1]
  def up
    drop_table :action_items
  end

  def down
    create_table "action_items", force: :cascade do |t|
      t.boolean "ai_generated", default: false, null: false
      t.integer "assignee_id"
      t.text "content", null: false
      t.datetime "created_at", null: false
      t.date "due_date"
      t.integer "meeting_id", null: false
      t.string "status", default: "todo", null: false
      t.datetime "updated_at", null: false
      t.index ["assignee_id"], name: "index_action_items_on_assignee_id"
      t.index ["meeting_id"], name: "index_action_items_on_meeting_id"
      t.check_constraint "status IN ('todo','in_progress','done')", name: "chk_action_items_status"
    end
  end
end
