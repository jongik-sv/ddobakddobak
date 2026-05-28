class RenameLocalAdminUser < ActiveRecord::Migration[8.1]
  # 로컬 자동로그인 계정(desktop@local)의 표시명을 "사용자" → "관리자"로 바꾸고
  # 역할을 admin으로 고정한다. 데이터만 정리하므로 down은 no-op.
  def up
    execute <<~SQL.squish
      UPDATE users
      SET name = '관리자', role = 'admin'
      WHERE email = 'desktop@local'
    SQL
  end

  def down
    # 되돌릴 필요 없음 (표시명/역할 정규화)
  end
end
