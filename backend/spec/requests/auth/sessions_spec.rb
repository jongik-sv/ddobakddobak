require "rails_helper"

RSpec.describe "Auth::Sessions", type: :request do
  let(:password) { "password123" }
  let(:user) { create(:user, password: password) }

  describe "POST /auth/login" do
    context "with valid credentials" do
      it "returns 200 with access_token, refresh_token, and user" do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json

        expect(response).to have_http_status(:ok)

        body = response.parsed_body
        expect(body["access_token"]).to be_present
        expect(body["refresh_token"]).to be_present
        expect(body["user"]["id"]).to eq(user.id)
        expect(body["user"]["email"]).to eq(user.email)
        expect(body["user"]["name"]).to eq(user.name)
      end

      it "returns a valid JWT access_token" do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json

        body = response.parsed_body
        secret = Devise::JWT.config.secret
        decoded = JWT.decode(body["access_token"], secret, true, algorithm: "HS256")
        payload = decoded.first

        # devise-jwt stores sub as string
        expect(payload["sub"]).to eq(user.id.to_s)
      end

      it "stores refresh_token_jti on the user" do
        expect { post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json }
          .to change { user.reload.refresh_token_jti }.from(nil)
      end
    end

    context "with wrong password" do
      it "returns 401" do
        post "/auth/login", params: { user: { email: user.email, password: "wrong" } }, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with non-existent email" do
      it "returns 401" do
        post "/auth/login", params: { user: { email: "nobody@example.com", password: "whatever" } }, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "POST /auth/refresh" do
    let!(:refresh_jti) { user.generate_refresh_token_jti! }
    let(:refresh_token) { JwtService.encode_refresh_token(user, refresh_jti) }

    context "with valid refresh_token" do
      it "returns a new access_token" do
        post "/auth/refresh", params: { refresh_token: refresh_token }, as: :json

        expect(response).to have_http_status(:ok)

        body = response.parsed_body
        expect(body["access_token"]).to be_present
      end

      it "returns an access_token that can authenticate API requests" do
        post "/auth/refresh", params: { refresh_token: refresh_token }, as: :json

        body = response.parsed_body
        new_access_token = body["access_token"]

        # Verify it decodes to the right user
        secret = Devise::JWT.config.secret
        decoded = JWT.decode(new_access_token, secret, true, algorithm: "HS256")
        expect(decoded.first["sub"]).to eq(user.id)
      end
    end

    context "with expired refresh_token" do
      it "returns 401" do
        expired_token = travel_to(31.days.ago) do
          JwtService.encode_refresh_token(user, refresh_jti)
        end

        post "/auth/refresh", params: { refresh_token: expired_token }, as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(response.parsed_body["error"]).to eq("Invalid refresh token")
      end
    end

    context "with revoked refresh_token (after logout)" do
      it "returns 401" do
        user.revoke_refresh_token!

        post "/auth/refresh", params: { refresh_token: refresh_token }, as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(response.parsed_body["error"]).to eq("Invalid refresh token")
      end
    end

    context "with invalid token" do
      it "returns 401" do
        post "/auth/refresh", params: { refresh_token: "garbage" }, as: :json

        expect(response).to have_http_status(:unauthorized)
        expect(response.parsed_body["error"]).to eq("Invalid refresh token")
      end
    end
  end

  describe "DELETE /auth/logout" do
    context "with valid access_token" do
      it "returns 200" do
        # Login first to get tokens
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        access_token = response.parsed_body["access_token"]

        delete "/auth/logout", headers: { "Authorization" => "Bearer #{access_token}" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["message"]).to eq("logged out")
      end

      it "invalidates the access_token (jti changes)" do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        access_token = response.parsed_body["access_token"]
        old_jti = user.reload.jti

        delete "/auth/logout", headers: { "Authorization" => "Bearer #{access_token}" }, as: :json

        expect(user.reload.jti).not_to eq(old_jti)
      end

      it "revokes the refresh_token" do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        access_token = response.parsed_body["access_token"]
        refresh_token = response.parsed_body["refresh_token"]

        delete "/auth/logout", headers: { "Authorization" => "Bearer #{access_token}" }, as: :json

        expect(user.reload.refresh_token_jti).to be_nil

        # Refresh should fail
        post "/auth/refresh", params: { refresh_token: refresh_token }, as: :json
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

end
