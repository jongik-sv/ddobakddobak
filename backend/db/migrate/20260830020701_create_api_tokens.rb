class CreateApiTokens < ActiveRecord::Migration[8.1]
  # 세컨드 브레인 외부 공개 API(/api/ext) 인증용 PAT. 평문은 저장하지 않고 SHA256 digest만 보관한다.
  def change
    create_table :api_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.string :token_digest, null: false
      t.string :token_prefix, null: false
      t.text :scopes, null: false, default: "[]"
      t.text :project_ids
      t.text :folder_ids
      t.datetime :expires_at, null: false
      t.datetime :revoked_at
      t.datetime :last_used_at

      t.timestamps
    end

    add_index :api_tokens, :token_digest, unique: true
  end
end
