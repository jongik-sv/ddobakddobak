class AddSourceToBlocks < ActiveRecord::Migration[8.1]
  # SQLite 테이블 재생성 마이그레이션을 피하기 위해 add_column만 사용한다.
  def change
    add_column :blocks, :source, :string, default: "user", null: false
  end
end
