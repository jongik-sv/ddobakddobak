class DropDecisions < ActiveRecord::Migration[8.1]
  def up
    drop_table :decisions
  end

  def down
    create_table "decisions", force: :cascade do |t|
      t.boolean "ai_generated", default: false, null: false
      t.text "content", null: false
      t.text "context"
      t.datetime "created_at", null: false
      t.datetime "decided_at"
      t.integer "meeting_id", null: false
      t.text "participants"
      t.string "status", default: "active", null: false
      t.datetime "updated_at", null: false
      t.index ["meeting_id"], name: "index_decisions_on_meeting_id"
      t.index ["status"], name: "index_decisions_on_status"
      t.check_constraint "status IN ('active','revised','cancelled')", name: "chk_decisions_status"
    end
  end
end
