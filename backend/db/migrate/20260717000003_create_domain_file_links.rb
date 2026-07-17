# 도메인 파일 "적용(링크)" 대상을 프로젝트/폴더/회의 3레벨로 일반화한다.
# 기존 meeting_domain_files(회의 전용)를 대체 — 데이터 이관은 후속 마이그레이션에서.
class CreateDomainFileLinks < ActiveRecord::Migration[8.1]
  def change
    create_table :domain_file_links do |t|
      t.references :domain_file, null: false, foreign_key: { on_delete: :cascade }
      t.string :owner_type, null: false
      t.bigint :owner_id, null: false
      t.timestamps
    end

    add_index :domain_file_links, [ :domain_file_id, :owner_type, :owner_id ],
              unique: true, name: "idx_domain_file_links_unique"
    add_index :domain_file_links, [ :owner_type, :owner_id ]
  end
end
