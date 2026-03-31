class CreateMeetingAttachments < ActiveRecord::Migration[8.1]
  def change
    create_table :meeting_attachments do |t|
      t.references :meeting, null: false
      t.references :uploaded_by, null: false

      t.string  :kind, null: false           # "file" | "link"
      t.string  :category, null: false       # "agenda" | "reference" | "minutes"
      t.string  :display_name, null: false

      t.string  :file_path
      t.string  :original_filename
      t.string  :content_type
      t.integer :file_size

      t.string  :url

      t.float   :position, null: false

      t.timestamps null: false
    end

    add_index :meeting_attachments,
              [:meeting_id, :category, :position],
              name: "idx_attachments_meeting_cat_pos"
  end
end
