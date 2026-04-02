module ApplicationCable
  class Connection < ActionCable::Connection::Base
    include DefaultUserLookup

    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      if server_mode?
        authenticate_websocket_user
      else
        local_default_user
      end
    end

    def authenticate_websocket_user
      token = extract_token
      return reject_unauthorized_connection unless token

      payload = decode_jwt(token)
      return reject_unauthorized_connection unless payload

      user = User.find_by(id: payload["sub"], jti: payload["jti"])
      return reject_unauthorized_connection unless user

      user
    end

    def extract_token
      # WebSocket connections pass token as query parameter
      # ws://server/cable?token=xxx
      request.params["token"]
    end

    def decode_jwt(token)
      secret = Devise::JWT.config.secret
      decoded = JWT.decode(token, secret, true, algorithm: "HS256")
      decoded.first
    rescue JWT::DecodeError, JWT::ExpiredSignature
      nil
    end

  end
end
