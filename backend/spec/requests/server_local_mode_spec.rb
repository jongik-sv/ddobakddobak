require "rails_helper"

RSpec.describe "Server/Local mode branching", type: :request do
  let(:password) { "password123" }
  let(:user) { create(:user, password: password) }

  describe "LOCAL mode (SERVER_MODE=false, default)" do
    include_context "local mode"

    it "allows API access without JWT (uses desktop@local)" do
      get "/api/v1/meetings", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "creates desktop@local user automatically" do
      get "/api/v1/meetings", as: :json
      expect(User.find_by(email: "desktop@local")).to be_present
    end

    it "health endpoint is accessible" do
      get "/api/v1/health", as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe "SERVER mode (SERVER_MODE=true)" do
    include_context "server mode"

    # 원격(LAN) 기기 시뮬레이션: REMOTE_ADDR을 비-loopback으로 둔다.
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    it "rejects remote API requests without JWT (401)" do
      get "/api/v1/meetings", headers: remote, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "allows remote API requests with valid JWT" do
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      token = response.parsed_body["access_token"]

      get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 401 with expired JWT" do
      expired_token = travel_to(25.hours.ago) do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        response.parsed_body["access_token"]
      end

      get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{expired_token}"), as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "health endpoint is accessible without JWT" do
      get "/api/v1/health", headers: remote, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "does not create desktop@local for remote requests" do
      get "/api/v1/meetings", headers: remote, as: :json  # 401, must not create desktop@local
      expect(User.find_by(email: "desktop@local")).to be_nil
    end

    # 하이브리드: 맥 본체(loopback) 요청은 로그인 없이 로컬 admin(desktop@local)으로 동작
    describe "loopback fallback (Mac 본체 데스크톱 앱)" do
      let(:loopback) { { "REMOTE_ADDR" => "127.0.0.1" } }

      it "allows loopback API requests without JWT" do
        get "/api/v1/meetings", headers: loopback, as: :json
        expect(response).to have_http_status(:ok)
      end

      it "acts as desktop@local with admin role" do
        get "/api/v1/meetings", headers: loopback, as: :json
        u = User.find_by(email: "desktop@local")
        expect(u).to be_present
        expect(u.role).to eq("admin")
      end

      it "explicit JWT wins over loopback fallback (scoped to the JWT user)" do
        member = create(:user, password: password, role: "member")
        create(:meeting, creator: create(:user))  # member가 볼 수 없는 남의 회의

        post "/auth/login", params: { user: { email: member.email, password: password } }, as: :json
        token = response.parsed_body["access_token"]

        get "/api/v1/meetings", headers: loopback.merge("Authorization" => "Bearer #{token}"), as: :json
        expect(response).to have_http_status(:ok)
        # member로 동작하면 본인 회의만(0). desktop@local admin이었다면 1이 보였을 것.
        expect(response.parsed_body["meta"]["total"]).to eq(0)
      end
    end
  end
end
