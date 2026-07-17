class CreateMeetingDomainFiles < ActiveRecord::Migration[8.1]
  def change
    create_table :meeting_domain_files do |t|
      t.references :meeting,     null: false, foreign_key: { on_delete: :cascade }
      t.references :domain_file, null: false, foreign_key: { on_delete: :cascade }
      t.timestamps
    end
    add_index :meeting_domain_files, [:meeting_id, :domain_file_id], unique: true
  end
end
