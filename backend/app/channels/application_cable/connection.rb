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
      token = request.params["token"]
      return reject_unauthorized_connection unless token

      payload = JwtService.decode(token)
      return reject_unauthorized_connection unless payload

      user = User.find_by(id: payload["sub"], jti: payload["jti"])
      return reject_unauthorized_connection unless user

      user
    end

  end
end
