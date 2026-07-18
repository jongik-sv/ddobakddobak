require "rails_helper"

RSpec.describe "Api::V1::LlmProfiles", type: :request do
  let(:user) { create(:user) }
  let(:admin) { create(:user, :admin) }

  describe "personal 풀" do
    before { login_as(user) }

    it "CRUD 왕복 + 토큰 마스킹 + blank 토큰 유지" do
      post "/api/v1/llm_profiles", params: { profile: {
        name: "Gemini · 무료키", preset_id: "gemini", provider: "openai",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.5-flash", auth_token: "AIza-secret-1234567890"
      } }, as: :json
      expect(response).to have_http_status(:created)
      body = response.parsed_body["profile"]
      expect(body["auth_token_masked"]).to be_present
      expect(body.to_json).not_to include("AIza-secret")
      id = body["id"]

      get "/api/v1/llm_profiles"
      expect(response.parsed_body["profiles"].map { |p| p["id"] }).to include(id)

      patch "/api/v1/llm_profiles/#{id}", params: { profile: { model: "gemini-2.5-flash", auth_token: "" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(LlmProfile.find(id).auth_token).to eq("AIza-secret-1234567890") # blank = 유지
      expect(LlmProfile.find(id).model).to eq("gemini-2.5-flash")

      delete "/api/v1/llm_profiles/#{id}"
      expect(response).to have_http_status(:no_content)
      expect(LlmProfile.exists?(id)).to be false
    end

    it "타인 프로필은 404" do
      other = LlmProfile.create!(user: create(:user), name: "X", preset_id: "openai", provider: "openai")
      patch "/api/v1/llm_profiles/#{other.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:not_found)
      delete "/api/v1/llm_profiles/#{other.id}"
      expect(response).to have_http_status(:not_found)
    end

    it "잘못된 provider는 422" do
      post "/api/v1/llm_profiles", params: { profile: { name: "C", preset_id: "claude_cli", provider: "claude_cli" } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "server 풀 (server mode)" do
    before { allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true) }

    it "admin은 CRUD 가능, 풀은 user_id nil로 저장" do
      login_as(admin)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "anthropic", provider: "anthropic", auth_token: "sk-ant-xxxx-123456" } }, as: :json
      expect(response).to have_http_status(:created)
      expect(LlmProfile.last.user_id).to be_nil

      get "/api/v1/llm_profiles?scope=server"
      expect(response.parsed_body["profiles"].size).to eq(1)
    end

    it "비admin은 server 풀 접근 403" do
      login_as(user)
      get "/api/v1/llm_profiles?scope=server"
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "openai", provider: "openai" } }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "비admin은 server 풀 프로필 수정·삭제도 403" do
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
      login_as(user)
      patch "/api/v1/llm_profiles/#{sp.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      delete "/api/v1/llm_profiles/#{sp.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end
end
