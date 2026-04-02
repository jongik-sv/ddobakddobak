class AddRefreshTokenJtiToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :refresh_token_jti, :string
    add_index :users, :refresh_token_jti, unique: true
  end
end
