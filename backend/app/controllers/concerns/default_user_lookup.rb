module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  LOOPBACK_IPS = %w[127.0.0.1 ::1 ::ffff:127.0.0.1].freeze

  def server_mode?
    ENV["SERVER_MODE"] == "true"
  end

  # 이 머신 자신(loopback)에서 온 요청인지 — 서버 모드에서 맥 본체의 데스크톱 앱을
  # 로컬 admin으로 취급하기 위한 판별. LAN/원격 기기는 비-loopback이라 JWT가 필요하다.
  # (caddy 등 신뢰 프록시 경유 시 request.remote_ip가 X-Forwarded-For의 실제 IP를 반영)
  def local_request?
    LOOPBACK_IPS.include?(request.remote_ip)
  end

  # Local mode only: find or create the default desktop@local user.
  # 로컬(데스크톱 단독) 사용자는 admin 권한 — 자기 머신의 모든 회의를 보고 제어할 수 있어야 함.
  # Callers must check server_mode? before invoking this method.
  def local_default_user
    User.find_or_create_by!(email: User::LOCAL_EMAIL) do |u|
      u.name = "사용자"
      u.role = "admin"
    end
  end
end
