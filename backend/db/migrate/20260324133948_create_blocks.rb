class CreateBlocks < ActiveRecord::Migration[8.1]
  def change
    create_table :blocks do |t|
      t.integer :meeting_id,     null: false
      t.string  :block_type,     null: false, default: "text"
      t.text    :content
      t.float   :position,       null: false
      t.integer :parent_block_id

      t.timestamps null: false
    end

    add_index :blocks, [ :meeting_id, :position ]
  end
end
