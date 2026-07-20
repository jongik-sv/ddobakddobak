class AddDflowFields < ActiveRecord::Migration[8.1]
  def change
    add_column :meetings, :public_uid, :string          # UUIDv7, 최초 D'Flow 전송 시 발급
    add_column :meetings, :dflow_synced_at, :datetime   # 마지막 전송 성공 시각
    add_column :meetings, :dflow_url, :string           # 전송 응답의 상세 페이지 링크
    add_index  :meetings, :public_uid, unique: true     # SQLite 부분 인덱스 불필요 — NULL 중복 허용됨
  end
end
