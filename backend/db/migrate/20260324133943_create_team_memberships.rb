class CreateTeamMemberships < ActiveRecord::Migration[8.1]
  def change
    create_table :team_memberships do |t|
      t.integer :user_id, null: false
      t.integer :team_id, null: false
      t.string  :role,    null: false, default: "member"

      t.timestamps null: false
    end

    add_index :team_memberships, [ :user_id, :team_id ], unique: true
    add_index :team_memberships, :team_id
  end
end
