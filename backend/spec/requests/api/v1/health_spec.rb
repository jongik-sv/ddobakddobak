require "rails_helper"

RSpec.describe "Api::V1::Health", type: :request do
  describe "GET /api/v1/health" do
    it "returns HTTP 200 OK" do
      get "/api/v1/health"
      expect(response).to have_http_status(:ok)
    end

    it "returns JSON with status ok" do
      get "/api/v1/health"
      json = JSON.parse(response.body)
      expect(json["status"]).to eq("ok")
    end

    it "returns JSON content type" do
      get "/api/v1/health"
      expect(response.content_type).to include("application/json")
    end

    it "LAN_WEB_URL 환경변수가 있으면 lan_url 반환" do
      ENV["LAN_WEB_URL"] = "https://172.30.1.3:13443"
      get "/api/v1/health"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["lan_url"]).to eq("https://172.30.1.3:13443")
    ensure
      ENV.delete("LAN_WEB_URL")
    end

    it "LAN_WEB_URL 없으면 lan_url 키 없음" do
      ENV.delete("LAN_WEB_URL")
      get "/api/v1/health"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).not_to have_key("lan_url")
    end
  end
end
