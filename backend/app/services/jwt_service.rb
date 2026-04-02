class JwtService
  SECRET = -> { Devise::JWT.config.secret }
  REFRESH_EXPIRATION = 30.days.to_i

  class << self
    def encode_refresh_token(user, jti)
      payload = {
        sub: user.id,
        jti: jti,
        type: "refresh",
        iat: Time.current.to_i,
        exp: REFRESH_EXPIRATION.seconds.from_now.to_i
      }
      JWT.encode(payload, SECRET.call, "HS256")
    end

    def decode_refresh_token(token)
      decoded = JWT.decode(token, SECRET.call, true, {
        algorithm: "HS256",
        verify_expiration: true
      })
      payload = decoded.first

      raise JWT::DecodeError, "Not a refresh token" unless payload["type"] == "refresh"

      payload
    end

    def decode(token)
      decoded = JWT.decode(token, SECRET.call, true, { algorithm: "HS256" })
      decoded.first
    rescue JWT::DecodeError, JWT::ExpiredSignature
      nil
    end

    def encode_access_token(user)
      payload = {
        sub: user.id,
        jti: user.jti,
        scp: "user",
        iat: Time.current.to_i,
        exp: Devise::JWT.config.expiration_time.seconds.from_now.to_i
      }
      JWT.encode(payload, SECRET.call, "HS256")
    end
  end
end
