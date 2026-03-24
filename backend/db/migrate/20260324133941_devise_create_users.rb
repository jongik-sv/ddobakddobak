# frozen_string_literal: true

class DeviseCreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      ## Database authenticatable
      t.string :email,              null: false, default: ""
      t.string :encrypted_password, null: false, default: ""

      ## User info
      t.string :name, null: false, default: ""

      ## JWT revocation
      t.string :jti, null: false

      t.timestamps null: false
    end

    add_index :users, :email, unique: true
    add_index :users, :jti,   unique: true
  end
end
