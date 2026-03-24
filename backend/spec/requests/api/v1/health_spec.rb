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
  end
end
