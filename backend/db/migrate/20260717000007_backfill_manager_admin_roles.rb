# 시스템 역할 3단계(admin/manager/member) 확장에 따른 초기 role 백필. 순수 UPDATE — 스키마 변경 없음,
# 모델 클래스 미사용(마이그레이션 시점 앱 코드와 분리). 20260717000006(CHECK 제약 확장) 이후에 실행되어야
# 한다 — 그 전에 role='manager' 를 넣으면 구 chk_users_role 제약에 막혀 실패한다.
# desktop@local 은 건드리지 않는다(admin 유지, 로컬 자동로그인 계정).
class BackfillManagerAdminRoles < ActiveRecord::Migration[8.1]
  MANAGER_EMAILS = %w[
    jjinie73@gmail.com
    donseok.lee@dongkuk.com
    younggoo.jung@dongkuk.com
    jungjin1.kim@dongkuk.com
    juhyun2.kim@dongkuk.com
  ].freeze

  def up
    placeholders = MANAGER_EMAILS.map { |e| connection.quote(e) }.join(",")
    execute "UPDATE users SET role='manager' WHERE email IN (#{placeholders}) AND role='admin'"
    execute "UPDATE users SET role='admin' WHERE email=#{connection.quote('jongik.jang@dongkuk.com')}"
  end

  # 원래 role 값을 추적하지 않으므로 되돌릴 수 없다 — 의도적 no-op.
  def down
    # no-op
  end
end
