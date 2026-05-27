module ApplicationCable
  class Connection < ActionCable::Connection::Base
    include DefaultUserLookup

    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    # HTTP(ApplicationController#resolve_current_user)와 동일한 하이브리드:
    # - 로컬 모드: 항상 desktop@local
    # - 서버 모드 + 토큰: JWT 검증 (명시 로그인 우선)
    # - 서버 모드 + loopback(토큰 없음): desktop@local 로컬 admin 폴백 (맥 본체 데스크톱 앱)
    # - 서버 모드 + 원격(토큰 없음): 거부
    def find_verified_user
      return local_default_user unless server_mode?

      token = request.params["token"]
      if token.present?
        authenticate_websocket_user(token)
      elsif local_request?
        local_default_user
      else
        reject_unauthorized_connection
      end
    end

    def authenticate_websocket_user(token)
      payload = JwtService.decode(token)
      return reject_unauthorized_connection unless payload

      user = User.find_by(id: payload["sub"], jti: payload["jti"])
      return reject_unauthorized_connection unless user

      user
    end

  end
end
