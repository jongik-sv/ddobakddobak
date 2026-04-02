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

    it "uses desktop@local as current_user for all requests" do
      get "/api/v1/meetings", as: :json
      expect(response).to have_http_status(:ok)
      expect(User.find_by(email: "desktop@local")).to be_present
    end

    it "health endpoint is accessible" do
      get "/api/v1/health", as: :json
      expect(response).to have_http_status(:ok)
    end
  end

  describe "SERVER mode (SERVER_MODE=true)" do
    include_context "server mode"

    it "rejects API requests without JWT (401)" do
      get "/api/v1/meetings", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "allows API requests with valid JWT" do
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      token = response.parsed_body["access_token"]

      get "/api/v1/meetings", headers: { "Authorization" => "Bearer #{token}" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 401 with expired JWT" do
      expired_token = travel_to(25.hours.ago) do
        post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
        response.parsed_body["access_token"]
      end

      get "/api/v1/meetings", headers: { "Authorization" => "Bearer #{expired_token}" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "health endpoint is accessible without JWT" do
      get "/api/v1/health", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "does not create desktop@local user" do
      get "/api/v1/meetings", as: :json  # 401 but should not create desktop@local
      expect(User.find_by(email: "desktop@local")).to be_nil
    end
  end
end
