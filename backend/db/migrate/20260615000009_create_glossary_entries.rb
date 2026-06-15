class CreateGlossaryEntries < ActiveRecord::Migration[8.0]
  def change
    create_table :glossary_entries do |t|
      t.string  :owner_type, null: false
      t.bigint  :owner_id,   null: false
      t.string  :from_text,  null: false
      t.string  :to_text,    null: false
      t.string  :match_type, null: false, default: "literal"
      t.boolean :enabled,    null: false, default: true
      t.bigint  :created_by_id
      t.timestamps
    end

    add_index :glossary_entries, %i[owner_type owner_id]
    add_index :glossary_entries, %i[owner_type owner_id from_text match_type],
              unique: true, name: "idx_glossary_unique_from"
  end
end
