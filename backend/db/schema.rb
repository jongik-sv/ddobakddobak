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

ActiveRecord::Schema[8.1].define(version: 2026_04_03_100001) do
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
  end

  create_table "folders", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.integer "parent_id"
    t.integer "position", default: 0, null: false
    t.integer "team_id"
    t.datetime "updated_at", null: false
    t.index ["parent_id"], name: "index_folders_on_parent_id"
    t.index ["team_id", "parent_id", "position"], name: "index_folders_on_team_id_and_parent_id_and_position"
    t.index ["team_id"], name: "index_folders_on_team_id"
  end

  create_table "meeting_attachments", force: :cascade do |t|
    t.string "category", null: false
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "display_name", null: false
    t.string "file_path"
    t.integer "file_size"
    t.string "kind", null: false
    t.integer "meeting_id", null: false
    t.string "original_filename"
    t.float "position", null: false
    t.datetime "updated_at", null: false
    t.integer "uploaded_by_id", null: false
    t.string "url"
    t.index ["meeting_id", "category", "position"], name: "idx_attachments_meeting_cat_pos"
    t.index ["meeting_id"], name: "index_meeting_attachments_on_meeting_id"
    t.index ["uploaded_by_id"], name: "index_meeting_attachments_on_uploaded_by_id"
  end

  create_table "meeting_bookmarks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "label"
    t.integer "meeting_id", null: false
    t.integer "timestamp_ms", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_id", "timestamp_ms"], name: "index_meeting_bookmarks_on_meeting_id_and_timestamp_ms"
    t.index ["meeting_id"], name: "index_meeting_bookmarks_on_meeting_id"
  end

  create_table "meeting_participants", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "joined_at", null: false
    t.datetime "left_at"
    t.integer "meeting_id", null: false
    t.string "role", default: "viewer", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["meeting_id", "role"], name: "idx_participants_meeting_role"
    t.index ["meeting_id", "user_id", "left_at"], name: "idx_participants_meeting_user_active"
    t.index ["meeting_id"], name: "index_meeting_participants_on_meeting_id"
    t.index ["user_id"], name: "index_meeting_participants_on_user_id"
  end

  create_table "meeting_templates", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "folder_id"
    t.string "meeting_type"
    t.string "name", null: false
    t.json "settings_json", default: {}
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["folder_id"], name: "index_meeting_templates_on_folder_id"
    t.index ["user_id"], name: "index_meeting_templates_on_user_id"
  end

  create_table "meetings", force: :cascade do |t|
    t.string "audio_file_path"
    t.string "brief_summary"
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "ended_at"
    t.integer "folder_id"
    t.integer "last_refined_seq", default: 0, null: false
    t.string "meeting_type", default: "general", null: false
    t.text "memo"
    t.string "share_code"
    t.string "source", default: "live", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.integer "team_id"
    t.string "title", null: false
    t.integer "transcription_progress", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id"], name: "index_meetings_on_created_by_id"
    t.index ["folder_id"], name: "index_meetings_on_folder_id"
    t.index ["share_code"], name: "index_meetings_on_share_code", unique: true
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

  create_table "taggings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "tag_id", null: false
    t.integer "taggable_id", null: false
    t.string "taggable_type", null: false
    t.datetime "updated_at", null: false
    t.index ["tag_id", "taggable_type", "taggable_id"], name: "index_taggings_uniqueness", unique: true
    t.index ["tag_id"], name: "index_taggings_on_tag_id"
    t.index ["taggable_type", "taggable_id"], name: "index_taggings_on_taggable"
  end

  create_table "tags", force: :cascade do |t|
    t.string "color", default: "#6b7280", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.integer "team_id"
    t.datetime "updated_at", null: false
    t.index ["team_id", "name"], name: "index_tags_on_team_id_and_name", unique: true
    t.index ["team_id"], name: "index_tags_on_team_id"
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
    t.string "audio_source", default: "mic", null: false
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
    t.text "llm_api_key"
    t.string "llm_base_url"
    t.string "llm_model"
    t.string "llm_provider"
    t.string "name", default: "", null: false
    t.string "refresh_token_jti"
    t.string "role", default: "member", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["jti"], name: "index_users_on_jti", unique: true
    t.index ["refresh_token_jti"], name: "index_users_on_refresh_token_jti", unique: true
  end

  add_foreign_key "meeting_bookmarks", "meetings"
  add_foreign_key "meeting_participants", "meetings"
  add_foreign_key "meeting_participants", "users"
  add_foreign_key "meeting_templates", "folders"
  add_foreign_key "meeting_templates", "users"
  add_foreign_key "taggings", "tags"
  add_foreign_key "tags", "teams"

  # Virtual tables defined in this database.
  # Note that virtual tables may not work with other database engines. Be careful if changing database.
  create_virtual_table "summaries_fts", "fts5", ["notes_markdown", "key_points", "decisions", "discussion_details", "source_id UNINDEXED", "tokenize='unicode61'"]
  create_virtual_table "transcripts_fts", "fts5", ["content", "speaker_label", "source_id UNINDEXED", "tokenize='unicode61'"]
end
