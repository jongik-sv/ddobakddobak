class CreateLlmProfiles < ActiveRecord::Migration[8.1]
  def change
    create_table :llm_profiles do |t|
      t.references :user, null: true, foreign_key: true # nil = 서버 풀(admin 전용)
      t.string :name, null: false
      t.string :preset_id, null: false
      t.string :provider, null: false
      t.string :base_url
      t.string :model
      t.text :auth_token
      t.integer :max_input_tokens
      t.integer :max_output_tokens
      t.timestamps
    end
    add_index :llm_profiles, [ :user_id, :name ], unique: true
    # SQLite는 NULL user_id 중복을 unique로 못 막음 — 서버 풀 이름 중복은 모델 검증이 담당
  end
end
