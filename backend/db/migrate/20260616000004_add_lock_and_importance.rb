class AddLockAndImportance < ActiveRecord::Migration[8.1]
  # 기능1 회의 잠금: locked_at 가 있으면 읽기전용(가드는 별도 task). nullable.
  # 기능2 중요 플래그: meetings/folders.important. 목록은 important=true 만 표시.
  #   회의 생성 시 소속 폴더의 important 를 기본값으로 상속(모델 콜백).
  def up
    add_column :meetings, :locked_at, :datetime
    add_column :meetings, :important, :boolean, null: false, default: false
    add_column :folders, :important, :boolean, null: false, default: false
    add_index :meetings, :important

    # 백필: 신규 컬럼 도입 전까지 "전부 보임"이던 현행 동작을 보존하기 위해
    # 기존 회의·폴더는 모두 important=true 로 채운다(신규 레코드만 default false).
    # reset_column_information 은 모델 클래스 메서드 — 새 컬럼을 캐시에 반영해야 update_all 이 동작.
    Meeting.reset_column_information
    Folder.reset_column_information
    Meeting.update_all(important: true)
    Folder.update_all(important: true)
  end

  def down
    remove_index :meetings, :important
    remove_column :folders, :important
    remove_column :meetings, :important
    remove_column :meetings, :locked_at
  end
end
