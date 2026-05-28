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

    # 로그인 성공 시 HTTP 리다이렉트 대신 "로그인 성공" 인터스티셜 페이지(200)를 렌더한다.
    # 페이지는 ddobak:// 딥링크(토큰 포함)를 <a href> 와 JS window.location.href 로 전달한다.
    # (브라우저가 커스텀 스킴 302를 안정적으로 따라가지 못하는 문제를 회피하는 의도된 UX)
    context "with valid credentials" do
      # 성공 페이지의 JS 자동이동 라인에서 딥링크 URL을 추출 (HTML 이스케이프 해제)
      def deep_link_from(body)
        CGI.unescapeHTML(body[/window\.location\.href = "([^"]+)"/, 1])
      end

      it "renders success page with ddobak:// deep link and tokens" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("ddobak://")
        expect(response.body).to include("access_token=")
        expect(response.body).to include("refresh_token=")
      end

      it "embeds a valid JWT access_token in the success page deep link" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://",
          authenticity_token: csrf_token
        }

        uri = URI.parse(deep_link_from(response.body))
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

      it "renders success page with custom callback path" do
        csrf_token = get_csrf_token

        post "/auth/web_login", params: {
          email: user.email,
          password: password,
          callback: "ddobak://auth-complete",
          authenticity_token: csrf_token
        }

        expect(response).to have_http_status(:ok)
        expect(response.body).to include("ddobak://auth-complete?")
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
