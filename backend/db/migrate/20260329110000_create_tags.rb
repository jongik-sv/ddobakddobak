class CreateTags < ActiveRecord::Migration[8.1]
  def change
    create_table :tags do |t|
      t.string :name, null: false
      t.string :color, null: false, default: "#6b7280"
      t.references :team, null: false, foreign_key: true
      t.timestamps
    end

    add_index :tags, [:team_id, :name], unique: true
  end
end
