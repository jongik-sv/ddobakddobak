require "rails_helper"

RSpec.describe JwtService do
  let(:user) { create(:user) }

  describe ".encode_refresh_token / .decode_refresh_token" do
    it "round-trips encode and decode successfully" do
      jti = user.generate_refresh_token_jti!
      token = JwtService.encode_refresh_token(user, jti)

      payload = JwtService.decode_refresh_token(token)
      expect(payload["sub"]).to eq(user.id)
      expect(payload["jti"]).to eq(jti)
      expect(payload["type"]).to eq("refresh")
    end

    it "raises JWT::ExpiredSignature for expired tokens" do
      jti = user.generate_refresh_token_jti!

      token = travel_to(31.days.ago) do
        JwtService.encode_refresh_token(user, jti)
      end

      expect { JwtService.decode_refresh_token(token) }.to raise_error(JWT::ExpiredSignature)
    end

    it "raises JWT::DecodeError for tokens with wrong type" do
      # Manually create a token without type=refresh
      secret = Devise::JWT.config.secret
      payload = {
        sub: user.id,
        jti: SecureRandom.uuid,
        type: "access",
        iat: Time.current.to_i,
        exp: 30.days.from_now.to_i
      }
      token = JWT.encode(payload, secret, "HS256")

      expect { JwtService.decode_refresh_token(token) }.to raise_error(JWT::DecodeError, "Not a refresh token")
    end

    it "raises JWT::DecodeError for invalid tokens" do
      expect { JwtService.decode_refresh_token("invalid.token.here") }.to raise_error(JWT::DecodeError)
    end
  end

  describe ".encode_access_token" do
    it "generates a valid Access Token" do
      token = JwtService.encode_access_token(user)

      secret = Devise::JWT.config.secret
      decoded = JWT.decode(token, secret, true, algorithm: "HS256")
      payload = decoded.first

      expect(payload["sub"]).to eq(user.id)
      expect(payload["scp"]).to eq("user")
      expect(payload["exp"]).to be_present
    end

    it "includes user.jti in the payload" do
      token = JwtService.encode_access_token(user)

      secret = Devise::JWT.config.secret
      decoded = JWT.decode(token, secret, true, algorithm: "HS256")
      payload = decoded.first

      expect(payload["jti"]).to eq(user.jti)
    end
  end
end
