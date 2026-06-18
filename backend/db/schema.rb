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

ActiveRecord::Schema[8.1].define(version: 2026_06_18_000002) do
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

  create_table "blocks", force: :cascade do |t|
    t.string "block_type", default: "text", null: false
    t.text "content"
    t.datetime "created_at", null: false
    t.integer "meeting_id", null: false
    t.integer "parent_block_id"
    t.float "position", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_id", "position"], name: "index_blocks_on_meeting_id_and_position"
    t.check_constraint "block_type IN ('text','heading1','heading2','heading3','bullet_list','numbered_list','checkbox','quote','divider')", name: "chk_blocks_block_type"
  end

  create_table "chat_messages", force: :cascade do |t|
    t.text "content", default: "", null: false
    t.datetime "created_at", null: false
    t.text "error_message"
    t.integer "meeting_id"
    t.string "role", null: false
    t.integer "scope_id"
    t.string "scope_type", default: "meeting", null: false
    t.string "status", default: "complete", null: false
    t.text "suggestions_json", default: "[]", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["meeting_id", "user_id", "created_at"], name: "index_chat_messages_on_meeting_id_and_user_id_and_created_at"
    t.index ["meeting_id"], name: "index_chat_messages_on_meeting_id"
    t.index ["scope_type", "scope_id", "user_id", "created_at"], name: "index_chat_messages_on_scope_and_user"
    t.index ["user_id"], name: "index_chat_messages_on_user_id"
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
    t.check_constraint "status IN ('active','revised','cancelled')", name: "chk_decisions_status"
  end

  create_table "folders", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "deleted_at"
    t.integer "deleted_by_id"
    t.boolean "important", default: false, null: false
    t.string "name", null: false
    t.integer "parent_id"
    t.integer "position", default: 0, null: false
    t.integer "project_id", null: false
    t.boolean "shared", default: true, null: false
    t.string "trash_group_id"
    t.boolean "trashed_as_root", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["deleted_at"], name: "index_folders_on_deleted_at"
    t.index ["parent_id"], name: "index_folders_on_parent_id"
    t.index ["project_id", "parent_id", "position"], name: "index_folders_on_project_id_and_parent_id_and_position"
    t.index ["shared"], name: "index_folders_on_shared"
    t.index ["trash_group_id"], name: "index_folders_on_trash_group_id"
  end

  create_table "glossary_entries", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "created_by_id"
    t.boolean "enabled", default: true, null: false
    t.string "from_text", null: false
    t.string "match_type", default: "literal", null: false
    t.bigint "owner_id", null: false
    t.string "owner_type", null: false
    t.string "to_text", null: false
    t.datetime "updated_at", null: false
    t.index ["owner_type", "owner_id", "from_text", "match_type"], name: "idx_glossary_unique_from", unique: true
    t.index ["owner_type", "owner_id"], name: "index_glossary_entries_on_owner_type_and_owner_id"
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
    t.index ["uploaded_by_id"], name: "index_meeting_attachments_on_uploaded_by_id"
    t.check_constraint "category IN ('agenda','reference','minutes','business_card')", name: "chk_meeting_attachments_category"
    t.check_constraint "kind IN ('file','link')", name: "chk_meeting_attachments_kind"
  end

  create_table "meeting_bookmarks", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "label"
    t.integer "meeting_id", null: false
    t.integer "timestamp_ms", null: false
    t.datetime "updated_at", null: false
    t.index ["meeting_id", "timestamp_ms"], name: "index_meeting_bookmarks_on_meeting_id_and_timestamp_ms"
  end

  create_table "meeting_contacts", force: :cascade do |t|
    t.text "address"
    t.string "company"
    t.datetime "created_at", null: false
    t.bigint "created_by_id", null: false
    t.string "department"
    t.string "email"
    t.json "extra"
    t.string "fax"
    t.integer "meeting_id", null: false
    t.string "mobile"
    t.string "name"
    t.string "phone"
    t.text "raw_text"
    t.bigint "source_attachment_id"
    t.string "title"
    t.datetime "updated_at", null: false
    t.string "website"
    t.index ["meeting_id"], name: "index_meeting_contacts_on_meeting_id"
    t.index ["source_attachment_id"], name: "index_meeting_contacts_on_source_attachment_id"
  end

  create_table "meeting_participants", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "host_disconnected_at"
    t.datetime "joined_at", null: false
    t.datetime "left_at"
    t.integer "meeting_id", null: false
    t.string "role", default: "viewer", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["meeting_id", "role"], name: "idx_participants_meeting_role"
    t.index ["meeting_id", "user_id", "left_at"], name: "idx_participants_meeting_user_active"
    t.index ["user_id"], name: "index_meeting_participants_on_user_id"
    t.check_constraint "role IN ('host','viewer')", name: "chk_meeting_participants_role"
  end

  create_table "meeting_templates", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "folder_id"
    t.string "meeting_type"
    t.string "name", null: false
    t.json "settings_json", default: {}
    t.datetime "updated_at", null: false
    t.index ["folder_id"], name: "index_meeting_templates_on_folder_id"
  end

  create_table "meetings", force: :cascade do |t|
    t.text "agenda_reference"
    t.datetime "agenda_reference_applied_at"
    t.text "attendees"
    t.integer "audio_duration_ms"
    t.string "audio_file_path"
    t.string "brief_summary"
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "deleted_at"
    t.integer "deleted_by_id"
    t.float "diarization_threshold"
    t.datetime "ended_at"
    t.integer "expected_participants"
    t.integer "folder_id"
    t.boolean "important", default: false, null: false
    t.integer "last_refined_seq", default: 0, null: false
    t.datetime "last_reset_at"
    t.datetime "last_user_edit_at"
    t.datetime "locked_at"
    t.string "meeting_type", default: "general", null: false
    t.text "memo"
    t.datetime "paused_at"
    t.integer "previous_meeting_id"
    t.integer "project_id", null: false
    t.datetime "re_diarize_started_at"
    t.string "share_code"
    t.boolean "shared", default: true, null: false
    t.string "source", default: "live", null: false
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.string "stt_engine"
    t.boolean "summary_restructure", default: true, null: false
    t.string "summary_verbosity", default: "standard", null: false
    t.string "title", null: false
    t.integer "transcription_progress", default: 0, null: false
    t.string "trash_group_id"
    t.boolean "trashed_as_root", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id", "shared"], name: "index_meetings_on_created_by_id_and_shared"
    t.index ["deleted_at"], name: "index_meetings_on_deleted_at"
    t.index ["folder_id"], name: "index_meetings_on_folder_id"
    t.index ["important"], name: "index_meetings_on_important"
    t.index ["previous_meeting_id"], name: "index_meetings_on_previous_meeting_id"
    t.index ["project_id", "status"], name: "index_meetings_on_project_id_and_status"
    t.index ["share_code"], name: "index_meetings_on_share_code", unique: true
    t.index ["trash_group_id"], name: "index_meetings_on_trash_group_id"
    t.check_constraint "source IN ('live','upload')", name: "chk_meetings_source"
    t.check_constraint "status IN ('pending','recording','transcribing','completed')", name: "chk_meetings_status"
    t.check_constraint "summary_verbosity IN ('very_concise','concise','standard','detailed','very_detailed')", name: "chk_meetings_summary_verbosity"
  end

  create_table "project_invites", force: :cascade do |t|
    t.string "code", null: false
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "expires_at"
    t.integer "max_uses"
    t.integer "project_id", null: false
    t.datetime "updated_at", null: false
    t.integer "use_count", default: 0, null: false
    t.index ["code"], name: "index_project_invites_on_code", unique: true
    t.index ["project_id"], name: "index_project_invites_on_project_id"
  end

  create_table "project_memberships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "project_id", null: false
    t.string "role", default: "member", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["project_id"], name: "index_project_memberships_on_project_id"
    t.index ["user_id", "project_id"], name: "index_project_memberships_on_user_id_and_project_id", unique: true
    t.check_constraint "role IN ('admin','member')", name: "chk_team_memberships_role"
  end

  create_table "projects", force: :cascade do |t|
    t.string "color"
    t.datetime "created_at", null: false
    t.integer "created_by_id", null: false
    t.datetime "deleted_at"
    t.integer "deleted_by_id"
    t.text "description"
    t.string "icon_type"
    t.string "icon_value"
    t.string "name", null: false
    t.boolean "personal", default: false, null: false
    t.string "trash_group_id"
    t.boolean "trashed_as_root", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["created_by_id"], name: "index_projects_on_created_by_id"
    t.index ["deleted_at"], name: "index_projects_on_deleted_at"
    t.index ["personal"], name: "index_projects_on_personal"
    t.index ["trash_group_id"], name: "index_projects_on_trash_group_id"
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
    t.check_constraint "summary_type IN ('realtime','final')", name: "chk_summaries_summary_type"
  end

  create_table "taggings", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "tag_id", null: false
    t.integer "taggable_id", null: false
    t.string "taggable_type", null: false
    t.datetime "updated_at", null: false
    t.index ["tag_id", "taggable_type", "taggable_id"], name: "index_taggings_uniqueness", unique: true
    t.index ["taggable_type", "taggable_id"], name: "index_taggings_on_taggable"
  end

  create_table "tags", force: :cascade do |t|
    t.string "color", default: "#6b7280", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.integer "project_id", null: false
    t.datetime "updated_at", null: false
    t.index ["project_id", "name"], name: "index_tags_on_project_id_and_name", unique: true
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
    t.string "speaker_name"
    t.integer "started_at_ms", null: false
    t.index ["meeting_id", "applied_to_minutes"], name: "index_transcripts_on_meeting_id_and_applied"
    t.index ["meeting_id", "sequence_number"], name: "index_transcripts_on_meeting_id_and_sequence_number"
  end

  create_table "users", force: :cascade do |t|
    t.string "chat_llm_model"
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.string "jti", null: false
    t.string "language_mode", default: "single"
    t.text "llm_api_key"
    t.string "llm_base_url"
    t.boolean "llm_enabled", default: true, null: false
    t.string "llm_model"
    t.string "llm_provider"
    t.string "name", default: "", null: false
    t.string "refresh_token_jti"
    t.string "role", default: "member", null: false
    t.string "selected_languages"
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["jti"], name: "index_users_on_jti", unique: true
    t.index ["refresh_token_jti"], name: "index_users_on_refresh_token_jti", unique: true
    t.check_constraint "role IN ('admin','member')", name: "chk_users_role"
  end

  add_foreign_key "chat_messages", "meetings", on_delete: :cascade
  add_foreign_key "chat_messages", "users"
  add_foreign_key "meeting_bookmarks", "meetings"
  add_foreign_key "meeting_contacts", "meeting_attachments", column: "source_attachment_id", on_delete: :nullify
  add_foreign_key "meeting_contacts", "meetings"
  add_foreign_key "meeting_contacts", "users", column: "created_by_id"
  add_foreign_key "meeting_participants", "meetings"
  add_foreign_key "meeting_participants", "users"
  add_foreign_key "meeting_templates", "folders"
  add_foreign_key "meetings", "folders", on_delete: :nullify
  add_foreign_key "meetings", "meetings", column: "previous_meeting_id", on_delete: :nullify
  add_foreign_key "meetings", "projects", on_delete: :cascade
  add_foreign_key "meetings", "users", column: "created_by_id"
  add_foreign_key "project_invites", "projects", on_delete: :cascade
  add_foreign_key "project_memberships", "projects", on_delete: :cascade
  add_foreign_key "project_memberships", "users", on_delete: :cascade
  add_foreign_key "projects", "users", column: "created_by_id"
  add_foreign_key "summaries", "meetings", on_delete: :cascade
  add_foreign_key "taggings", "tags"
  add_foreign_key "tags", "projects"
  add_foreign_key "transcripts", "meetings", on_delete: :cascade

  # Virtual tables defined in this database.
  # Note that virtual tables may not work with other database engines. Be careful if changing database.
  create_virtual_table "summaries_fts", "fts5", ["notes_markdown", "key_points", "decisions", "discussion_details", "source_id UNINDEXED", "tokenize='unicode61'"]
  create_virtual_table "transcripts_fts", "fts5", ["content", "speaker_label", "speaker_name", "source_id UNINDEXED", "tokenize='unicode61'"]
end
