class CreateMeetingCollaborators < ActiveRecord::Migration[8.1]
  # idea 44: 회의 개별 협업자 지정 — role 없이 존재 유무로 판단(project_memberships 패턴과 달리
  # 단순 이진 부여/철회). meeting_id+user_id 로 유일성 보장.
  def change
    create_table :meeting_collaborators do |t|
      t.references :meeting, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.timestamps
    end

    add_index :meeting_collaborators, [ :meeting_id, :user_id ], unique: true
  end
end
