class CreateMeetingContacts < ActiveRecord::Migration[8.0]
  def change
    create_table :meeting_contacts do |t|
      t.references :meeting, null: false, foreign_key: true
      t.string :name
      t.string :company
      t.string :department
      t.string :title
      t.string :mobile
      t.string :phone
      t.string :fax
      t.string :email
      t.string :website
      t.text   :address
      t.json   :extra
      t.text   :raw_text
      t.bigint :source_attachment_id
      t.bigint :created_by_id, null: false
      t.timestamps
    end

    add_index :meeting_contacts, :source_attachment_id
  end
end
