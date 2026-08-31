require "rails_helper"
require "zip"

# ext_skill/ 스킬 패키지 다운로드(zip) HTTP 경계 테스트.
# ⚠️ Task A가 라우트를 아직 추가하지 않았다(2026-08-30 시점). 컨트롤러는
# Api::V1::SkillPackagesController라 관례상 /api/v1/skill_package로 붙을
# 가능성이 높지만, 브리프의 계약표는 PAT 인증 엔드포인트를 /api/ext/v1/*로
# 명시하므로 두 후보를 모두 프로빙해 먼저 해석되는 경로를 쓴다 — 어느 쪽으로
# 라우트가 붙어도 이 스펙이 자동으로 활성화된다. 둘 다 없으면 전체 skip.
CANDIDATE_SKILL_PACKAGE_PATHS = [ "/api/v1/skill_package", "/api/ext/v1/skill_package" ].freeze

RSpec.describe "Api::V1::SkillPackages", type: :request do
  let!(:user) { create(:user) }

  before { login_as(user) }

  resolved_path = CANDIDATE_SKILL_PACKAGE_PATHS.find do |path|
    begin
      Rails.application.routes.recognize_path(path, method: :get)
      true
    rescue ActionController::RoutingError
      false
    end
  end
  skip_reason = resolved_path ? false : "라우트 미정(Task A 대기, 후보: #{CANDIDATE_SKILL_PACKAGE_PATHS.join(', ')}) — 통합 단계에서 skip 해제"
  path = resolved_path || CANDIDATE_SKILL_PACKAGE_PATHS.first

  describe "GET #{CANDIDATE_SKILL_PACKAGE_PATHS.join(' or ')}" do
    # 이 코드베이스의 인증은 로컬 모드(SERVER_MODE off)에서 항상
    # desktop@local로 통과한다(app/controllers/application_controller.rb
    # resolve_current_user). "인증 없음"은 서버 모드 + 원격(non-loopback)
    # 요청 + JWT 없음 조합에서만 재현된다(server_mode_context.rb 관례).
    context "서버 모드에서 인증 없는 원격 요청" do
      include_context "server mode"

      it "401을 반환한다", skip: skip_reason do
        get path, env: { "REMOTE_ADDR" => "203.0.113.5" }
        expect(response).to have_http_status(:unauthorized)
      end
    end

    it "인증된 사용자에게 zip을 반환한다", skip: skip_reason do
      get path

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to include("application/zip")
      expect(response.headers["Content-Disposition"]).to include("ddobak-skill.zip")
    end

    it "zip 엔트리에 SKILL.md와 .env.ddobak이 포함된다", skip: skip_reason do
      get path

      entries = nil
      Tempfile.create([ "skill", ".zip" ]) do |tf|
        tf.binmode
        tf.write(response.body)
        tf.flush
        entries = Zip::File.open(tf.path) { |zf| zf.entries.map(&:name) }
      end

      expect(entries).to include("SKILL.md", "AGENT.md", "README.md", "scripts/ddobak_api.py", ".env.ddobak")
    end

    it ".env.ddobak에 DDOBAK_API_URL이 request.base_url로 채워지고 토큰 줄은 주석 처리된다", skip: skip_reason do
      get path

      env_content = nil
      Tempfile.create([ "skill", ".zip" ]) do |tf|
        tf.binmode
        tf.write(response.body)
        tf.flush
        Zip::File.open(tf.path) do |zf|
          env_content = zf.read(".env.ddobak")
        end
      end

      expect(env_content).to match(/^DDOBAK_API_URL=https?:\/\/.+$/)
      expect(env_content).to include("# DDOBAK_API_TOKEN=")
      expect(env_content).to include("# DDOBAK_API_INSECURE=1")
    end
  end
end
