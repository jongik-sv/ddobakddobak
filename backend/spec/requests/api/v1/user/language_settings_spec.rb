require "rails_helper"

RSpec.describe "Api::V1::User::LanguageSettings", type: :request do
  let(:user) { create(:user) }

  before { login_as(user) }

  describe "GET /api/v1/user/language_settings" do
    context "언어 미설정 사용자" do
      it "configured: false와 server_default를 반환한다" do
        get "/api/v1/user/language_settings"

        expect(response).to have_http_status(:ok)
        body = response.parsed_body
        expect(body["language_settings"]["configured"]).to be false
        expect(body).to have_key("server_default")
        expect(body["server_default"]).to have_key("mode")
        expect(body["server_default"]).to have_key("languages")
      end
    end

    context "언어 설정된 사용자" do
      let(:user) { create(:user, language_mode: "multi", selected_languages: "ko,en") }

      it "mode와 languages 배열을 반환한다" do
        get "/api/v1/user/language_settings"

        body = response.parsed_body
        expect(body["language_settings"]["configured"]).to be true
        expect(body["language_settings"]["mode"]).to eq("multi")
        expect(body["language_settings"]["languages"]).to eq(%w[ko en])
      end
    end
  end

  describe "PUT /api/v1/user/language_settings" do
    it "언어 설정을 저장한다" do
      put "/api/v1/user/language_settings", params: {
        language_settings: { mode: "multi", languages: %w[ko en ja] }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.language_mode).to eq("multi")
      expect(user.selected_languages_list).to eq(%w[ko en ja])

      body = response.parsed_body
      expect(body["language_settings"]["configured"]).to be true
      expect(body["language_settings"]["languages"]).to eq(%w[ko en ja])
    end

    it "single 모드를 저장한다" do
      put "/api/v1/user/language_settings", params: {
        language_settings: { mode: "single", languages: %w[ko] }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(user.reload.language_mode).to eq("single")
    end

    it "잘못된 mode 값 시 422를 반환한다" do
      put "/api/v1/user/language_settings", params: {
        language_settings: { mode: "bogus", languages: %w[ko] }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to include("mode")
    end

    it "languages 빈 배열 시 개인 설정을 초기화한다 (서버 기본 폴백)" do
      user.update!(language_mode: "multi", selected_languages: "ko,en")

      put "/api/v1/user/language_settings", params: {
        language_settings: { mode: "single", languages: [] }
      }, as: :json

      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.language_configured?).to be false

      body = response.parsed_body
      expect(body["language_settings"]["configured"]).to be false
    end
  end

  # NOTE: 서버모드 미인증 401 검증은 생략한다. request spec의 login_as가
  # local_default_user를 전역 스텁하여 서버모드 폴백을 무력화하는 알려진 하네스
  # 갭 때문(llm_settings_spec과 동일). 인증은 authenticate_user! before_action으로
  # llm_settings와 동일하게 강제된다.
end
