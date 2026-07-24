class CreateFolderCollaborators < ActiveRecord::Migration[8.1]
  # idea 44: 폴더 단위 협업자 지정 — 하위 폴더·회의에 실시간 상속(스냅샷 아님, Folder#collaborator?
  # 조회 시점에 ancestor_records 체인을 평가). meeting_collaborators와 동형 구조.
  def change
    create_table :folder_collaborators do |t|
      t.references :folder, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.timestamps
    end

    add_index :folder_collaborators, [ :folder_id, :user_id ], unique: true
  end
end
