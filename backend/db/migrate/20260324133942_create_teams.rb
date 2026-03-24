class CreateTeams < ActiveRecord::Migration[8.1]
  def change
    create_table :teams do |t|
      t.string  :name,           null: false
      t.integer :created_by_id,  null: false

      t.timestamps null: false
    end

    add_index :teams, :created_by_id
  end
end
