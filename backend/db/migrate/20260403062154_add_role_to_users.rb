class AddRoleToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :role, :string, default: "member", null: false

    # Data migration: set the first user as admin
    execute <<-SQL
      UPDATE users SET role = 'admin'
      WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)
    SQL
  end

  def down
    remove_column :users, :role
  end
end
