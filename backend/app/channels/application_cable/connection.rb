module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_verified_user
    end

    private

    def find_verified_user
      token = extract_token
      return reject_unauthorized_connection if token.blank?

      payload, = JWT.decode(
        token,
        Rails.application.credentials.secret_key_base,
        true,
        algorithms: [ "HS256" ]
      )

      user = User.find_by(id: payload["sub"], jti: payload["jti"])
      user || reject_unauthorized_connection
    rescue JWT::DecodeError
      reject_unauthorized_connection
    end

    def extract_token
      request.params[:token] ||
        request.headers["Authorization"]&.delete_prefix("Bearer ")
    end
  end
end
