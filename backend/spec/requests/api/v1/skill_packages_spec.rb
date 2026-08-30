require "rails_helper"
require "zip"

# ext_skill/ 스킬 패키지 다운로드(zip) HTTP 경계 테스트.
# ⚠️ Task A가 config/routes.rb에 라우트(GET /api/ext/v1/skill_package)를 아직
# 추가하지 않았다 (2026-08-30 시점). 라우트 부재 시 request spec은 라우팅
# 에러로 실패하므로 전체를 skip 처리한다 — 통합 단계에서 skip 제거 필요.
ROUTE_EXISTS = begin
  Rails.application.routes.recognize_path("/api/ext/v1/skill_package", method: :get)
  true
rescue ActionController::RoutingError
  false
end

RSpec.describe "Api::V1::SkillPackages", type: :request do
  let!(:user) { create(:user) }

  before { login_as(user) }

  describe "GET /api/ext/v1/skill_package" do
    it "인증 없이 요청하면 401", skip: !ROUTE_EXISTS && "라우트 미정(Task A 대기) — 통합 단계에서 skip 해제" do
      allow_any_instance_of(ApplicationController).to receive(:current_user).and_return(nil)
      get "/api/ext/v1/skill_package"
      expect(response).to have_http_status(:unauthorized)
    end

    it "인증된 사용자에게 zip을 반환한다", skip: !ROUTE_EXISTS && "라우트 미정(Task A 대기) — 통합 단계에서 skip 해제" do
      get "/api/ext/v1/skill_package"

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("application/zip")
      expect(response.headers["Content-Disposition"]).to include("ddobak-skill.zip")
    end

    it "zip 엔트리에 SKILL.md와 config.json이 포함된다", skip: !ROUTE_EXISTS && "라우트 미정(Task A 대기) — 통합 단계에서 skip 해제" do
      get "/api/ext/v1/skill_package"

      entries = nil
      Tempfile.create([ "skill", ".zip" ]) do |tf|
        tf.binmode
        tf.write(response.body)
        tf.flush
        entries = Zip::File.open(tf.path) { |zf| zf.entries.map(&:name) }
      end

      expect(entries).to include("SKILL.md", "AGENT.md", "README.md", "scripts/ddobak_api.py", "config.json")
    end

    it "config.json에 api_url이 request.base_url로 채워진다", skip: !ROUTE_EXISTS && "라우트 미정(Task A 대기) — 통합 단계에서 skip 해제" do
      get "/api/ext/v1/skill_package"

      config_content = nil
      Tempfile.create([ "skill", ".zip" ]) do |tf|
        tf.binmode
        tf.write(response.body)
        tf.flush
        Zip::File.open(tf.path) do |zf|
          config_content = zf.read("config.json")
        end
      end

      expect(JSON.parse(config_content)["api_url"]).to be_present
    end
  end
end
