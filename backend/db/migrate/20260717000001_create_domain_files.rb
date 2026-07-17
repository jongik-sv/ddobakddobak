class CreateDomainFiles < ActiveRecord::Migration[8.1]
  def change
    create_table :domain_files do |t|
      t.string :name, null: false
      t.text :content, null: false, default: ""
      t.references :project, null: true, foreign_key: true            # nil = 전역(공용)
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_index :domain_files, [:project_id, :name], unique: true
    # SQLite는 NULL project_id 중복을 unique로 못 막음 — 전역 파일 이름 중복은 모델 검증이 담당
  end
end
