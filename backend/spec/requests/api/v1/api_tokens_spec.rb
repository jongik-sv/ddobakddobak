require "rails_helper"

RSpec.describe "Api::V1::ApiTokens", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  before { login_as(user) }

  describe "POST /api/v1/api_tokens" do
    it "발급 시 평문이 1회만 노출되고 digest는 응답에 없다" do
      post "/api/v1/api_tokens", params: {
        name: "내 스킬 토큰", scopes: %w[meetings:read], expires_at: 30.days.from_now
      }, as: :json

      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["plaintext"]).to start_with("ddbk_")
      expect(body["token"]).not_to have_key("token_digest")
      expect(body["token"]["scopes"]).to eq(%w[meetings:read])
    end

    it "스코프·만료 검증 오류는 422" do
      post "/api/v1/api_tokens", params: {
        name: "x", scopes: %w[bogus_scope], expires_at: 30.days.from_now
      }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "과거 만료 시각은 422" do
      post "/api/v1/api_tokens", params: {
        name: "x", scopes: %w[meetings:read], expires_at: 1.day.ago
      }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "GET /api/v1/api_tokens" do
    it "본인 것만 반환하고 digest는 노출하지 않는다" do
      mine = create(:api_token, user: user)
      create(:api_token, user: other_user)

      get "/api/v1/api_tokens"

      expect(response).to have_http_status(:ok)
      ids = response.parsed_body["tokens"].map { |t| t["id"] }
      expect(ids).to eq([ mine.id ])
      expect(response.parsed_body["tokens"].first).not_to have_key("token_digest")
    end
  end

  describe "DELETE /api/v1/api_tokens/:id" do
    it "본인 토큰은 revoke!(행 삭제 아님)로 204" do
      token = create(:api_token, user: user)
      delete "/api/v1/api_tokens/#{token.id}"

      expect(response).to have_http_status(:no_content)
      expect(ApiToken.exists?(token.id)).to be true
      expect(token.reload.revoked_at).to be_present
    end

    it "타인 토큰은 404" do
      token = create(:api_token, user: other_user)
      delete "/api/v1/api_tokens/#{token.id}"
      expect(response).to have_http_status(:not_found)
    end
  end
end
