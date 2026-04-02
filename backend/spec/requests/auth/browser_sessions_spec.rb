require "rails_helper"

RSpec.describe "Auth::BrowserSessions", type: :request do
  let(:password) { "password123" }
  let(:user) { create(:user, password: password) }

  describe "GET /auth/web_login" do
    context "with valid callback" do
      it "returns 200 with HTML login form" do
        get "/auth/web_login", params: { callback: "ddobak://" }

        expect(response).to have_http_status(:ok)
        expect(response.content_type).to include("text/html")
        expect(response.body).to include("이메일")
        expect(response.body).to include("비밀번호")
        expect(response.body).to include("authenticity_token")
      end

      it "includes callback value in hidden field" do
        get "/auth/web_login", params: { callback: "ddobak://callback" }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("ddobak://callback")
      end

      it "includes CSRF token in hidden field" do
        get "/auth/web_login", params: { callback: "ddobak://" }

        expect(response.body).to match(/name="authenticity_token" value="[^"]+/)
      end

      it "includes Tailwind CSS CDN script" do
        get "/auth/web_login", params: { callback: "ddobak://" }

        expect(response.body).to include("cdn.tailwindcss.com")
      end
    end

    context "with invalid callback scheme" do
      it "returns 400 error page for https scheme" do
        get "/auth/web_login", params: { callback: "https://evil.com" }

        expect(response).to have_http_status(:bad_request)
        expect(response.content_type).to include("text/html")
        expect(response.body).to include("잘못된 callback URL입니다")
      end

      it "returns 400 error page for http scheme" do
        get "/auth/web_login", params: { callback: "http://example.com" }

        expect(response).to have_http_status(:bad_request)
      end

      it "returns 400 error page for javascript scheme" do
        get "/auth/web_login", params: { callback: "javascript:alert(1)" }

        expect(response).to have_http_status(:bad_request)
      end
    end

    context "without callback parameter" do
      it "returns 400 error page" do
        get "/auth/web_login"

        expect(response).to have_http_status(:bad_request)
        expect(response.content_type).to include("text/html")
        expect(response.body).to include("잘못된 callback URL입니다")
      end
    end
  end

  describe "POST /auth/web_login" do
    def get_csrf_token
      get "/auth/web_login", params: { callback: "ddobak://" }
      response.body.match(/name="authenticity_token" value="([^"]+)"/)[1]
    end

    context "with valid credentials" do
      it "redirects to ddobak:// deep link with tokens" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:redirect)
        expect(response.location).to start_with("ddobak://")
        expect(response.location).to include("access_token=")
        expect(response.location).to include("refresh_token=")
      end

      it "includes valid JWT access_token in redirect URL" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        uri = URI.parse(response.location)
        params = URI.decode_www_form(uri.query).to_h

        secret = Devise::JWT.config.secret
        decoded = JWT.decode(params["access_token"], secret, true, algorithm: "HS256")
        expect(decoded.first["sub"]).to eq(user.id)
      end

      it "stores refresh_token_jti on the user" do
        csrf_token = get_csrf_token

        expect {
          post "/auth/web_login", params: {
            email: user.email,
            password: password,
            callback: "ddobak://",
            authenticity_token: csrf_token
          }
        }.to change { user.reload.refresh_token_jti }.from(nil)
      end

      it "redirects to callback with custom path" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://auth-complete",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:redirect)
        expect(response.location).to start_with("ddobak://auth-complete?")
      end
    end

    context "with invalid password" do
      it "returns 401 with error message in login form" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: "wrong",
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:unauthorized)
        expect(response.content_type).to include("text/html")
        expect(response.body).to include("이메일 또는 비밀번호가 올바르지 않습니다")
      end
    end

    context "with non-existent email" do
      it "returns 401 with error message" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: "nobody@example.com",
          password: "whatever",
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:unauthorized)
        expect(response.body).to include("이메일 또는 비밀번호가 올바르지 않습니다")
      end
    end

    context "with invalid callback scheme" do
      it "returns 400 error page" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "https://evil.com",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:bad_request)
      end
    end

    context "with invalid CSRF token" do
      it "returns 422 Unprocessable Entity" do
        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: "invalid-token"
        }

        expect(response).to have_http_status(:unprocessable_content)
      end
    end

    context "without CSRF token" do
      it "returns 422 Unprocessable Entity" do
        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://"
        }

        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end
end
