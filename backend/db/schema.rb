# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_03_29_034848) do
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
  end

  create_table "blocks", force: :cascade do |t|
    t.string "block_type", default: "text", null: false
    t.text "content"
    t.datetime "created_at", null: false
    t.integer "meeting_id", null: false
    t.integer "parent_block_id"
    t.float "position", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_id", "position"], name: "index_blocks_on_meeting_id_and_position"
  end

  create_table "meetings", force: :cascade do |t|
    t.string "audio_file_path"
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "ended_at"
    t.integer "last_refined_seq", default: 0, null: false
    t.string "meeting_type", default: "general", null: false
    t.string "source", default: "live", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.integer "team_id", null: false
    t.string "title", null: false
    t.integer "transcription_progress", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id"], name: "index_meetings_on_created_by_id"
    t.index ["team_id", "status"], name: "index_meetings_on_team_id_and_status"
    t.index ["team_id"], name: "index_meetings_on_team_id"
  end

  create_table "prompt_templates", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.boolean "is_default", default: false, null: false
    t.string "label", null: false
    t.string "meeting_type", null: false
    t.text "sections_prompt", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_type"], name: "index_prompt_templates_on_meeting_type", unique: true
  end

  create_table "summaries", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "decisions"
    t.text "discussion_details"
    t.datetime "generated_at", null: false
    t.text "key_points"
    t.integer "meeting_id", null: false
    t.text "notes_markdown"
    t.string "summary_type", default: "final", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_id"], name: "index_summaries_on_meeting_id"
  end

  create_table "team_memberships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "role", default: "member", null: false
    t.integer "team_id", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["team_id"], name: "index_team_memberships_on_team_id"
    t.index ["user_id", "team_id"], name: "index_team_memberships_on_user_id_and_team_id", unique: true
  end

  create_table "teams", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id"], name: "index_teams_on_created_by_id"
  end

  create_table "transcripts", force: :cascade do |t|
    t.boolean "applied_to_minutes", default: false, null: false
    t.text "content", null: false
    t.datetime "created_at", null: false
    t.integer "ended_at_ms", null: false
    t.integer "meeting_id", null: false
    t.integer "sequence_number", null: false
    t.string "speaker_label", null: false
    t.integer "started_at_ms", null: false
    t.index ["meeting_id", "sequence_number"], name: "index_transcripts_on_meeting_id_and_sequence_number"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.string "jti", null: false
    t.string "name", default: "", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["jti"], name: "index_users_on_jti", unique: true
  end
end
