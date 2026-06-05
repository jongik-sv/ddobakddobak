class AddSharedToFolders < ActiveRecord::Migration[8.0]
  # 폴더 공유/비공개 (추가요청 #2). 기본 true → 기존 폴더는 모두 공개 상태로 백필되어
  # 가시성을 막지 않는다(안의 회의는 각자 meetings.shared 설정을 따른다).
  # 폴더를 false(비공개)로 하면 그 폴더에 직접 담긴 모든 회의가 비공개가 된다
  # (유효 가시성 = meetings.shared AND folders.shared).
  def change
    add_column :folders, :shared, :boolean, default: true, null: false
    add_index :folders, :shared
  end
end
