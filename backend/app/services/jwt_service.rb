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

    # 로그인/초대-가입 공통 세션 발급 페이로드. 두 경로의 토큰·user 해시가 갈라지지 않도록 단일화한다.
    # refresh 토큰과 user 해시는 항상 동일하게 발급한다.
    # access_token: 호출자가 직접 줄 수 있다(예: SessionsController 는 devise-jwt 의 warden 토큰을
    #   넘겨 응답을 종전과 바이트 동일하게 유지 — 그 토큰은 sub 를 문자열로 직렬화). nil 이면
    #   encode_access_token 으로 생성한다(초대-가입 경로).
    def issue_session(user, access_token: nil)
      {
        access_token: access_token || encode_access_token(user),
        refresh_token: encode_refresh_token(user, user.generate_refresh_token_jti!),
        user: { id: user.id, email: user.email, name: user.name, role: user.role }
      }
    end
  end
end
