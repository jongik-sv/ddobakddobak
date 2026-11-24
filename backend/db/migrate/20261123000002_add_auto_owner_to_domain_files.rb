class AddAutoOwnerToDomainFiles < ActiveRecord::Migration[8.1]
  def change
    add_column :domain_files, :auto_kind, :string
    add_column :domain_files, :auto_owner_type, :string
    add_column :domain_files, :auto_owner_id, :bigint
    add_index :domain_files, [ :auto_kind, :auto_owner_type, :auto_owner_id ],
              unique: true, where: "auto_kind IS NOT NULL", name: "idx_domain_files_auto_owner"
    # SQLite 는 NULL 을 서로 다른 값으로 보므로 전역 자동 파일 1개는 부분 인덱스로 보장한다.
    add_index :domain_files, [ :auto_kind ],
              unique: true, where: "auto_kind = 'stt_auto' AND auto_owner_type IS NULL",
              name: "idx_domain_files_auto_global"
  end
end
