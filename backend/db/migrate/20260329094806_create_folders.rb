class CreateFolders < ActiveRecord::Migration[8.1]
  def change
    create_table :folders do |t|
      t.string  :name, null: false
      t.integer :team_id, null: false
      t.integer :parent_id
      t.integer :position, default: 0, null: false

      t.timestamps
    end

    add_index :folders, :team_id
    add_index :folders, :parent_id
    add_index :folders, [:team_id, :parent_id, :position]
  end
end
