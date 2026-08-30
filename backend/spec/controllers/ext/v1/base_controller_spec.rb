require "rails_helper"

# Ext::V1::BaseController 단위 스펙 — 실제 라우트 없이 컨트롤러를 직접 조립해 검증한다
# (spec/controllers/concerns/default_user_lookup_spec.rb와 동일 패턴).
RSpec.describe Ext::V1::BaseController do
  describe "Devise 헬퍼 차단" do
    it "current_user/authenticate_user!/warden/sign_in/sign_out/user_signed_in?는 undef되어 있다" do
      %i[current_user authenticate_user! warden sign_in sign_out user_signed_in?].each do |m|
        expect(described_class.new).not_to respond_to(m)
      end
    end
  end

  describe "#require_scope!" do
    def controller_with_token(scopes:)
      controller = described_class.new
      token = create(:api_token, scopes: scopes)
      controller.instance_variable_set(:@api_token, token)
      controller
    end

    it "스코프가 있으면 통과한다(예외 없음)" do
      controller = controller_with_token(scopes: %w[meetings:write])
      expect { controller.send(:require_scope!, "meetings:write") }.not_to raise_error
    end

    it "스코프가 없으면 InsufficientScopeError를 raise한다 — render만 하고 반환하지 않는 이전 버그(가드 아님)의 회귀 방지" do
      controller = controller_with_token(scopes: %w[meetings:read])
      expect { controller.send(:require_scope!, "meetings:write") }
        .to raise_error(described_class::InsufficientScopeError) { |e| expect(e.scope).to eq("meetings:write") }
    end
  end

  describe "GET (Rack 직접 dispatch) — require_scope! → rescue_from 403 라운드트립" do
    let(:test_controller_class) do
      Class.new(described_class) do
        def index
          require_scope!("meetings:write")
          render json: { ok: true }
        end
      end
    end

    def call(plaintext)
      env = Rack::MockRequest.env_for("/", method: "GET", "HTTP_AUTHORIZATION" => "Bearer #{plaintext}")
      status, headers, body = test_controller_class.action(:index).call(env)
      raw = +""
      body.each { |part| raw << part }
      [ status, headers, raw ]
    end

    it "스코프 부족 시 403 {error:{code:'insufficient_scope',...}}" do
      user = create(:user)
      _token, plaintext = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now)

      status, _headers, raw = call(plaintext)

      expect(status).to eq(403)
      expect(JSON.parse(raw)["error"]["code"]).to eq("insufficient_scope")
    end

    it "스코프 충족 시 액션이 정상 실행된다" do
      user = create(:user)
      _token, plaintext = ApiToken.issue!(user: user, name: "x", scopes: %w[meetings:write], expires_at: 1.day.from_now)

      status, _headers, raw = call(plaintext)

      expect(status).to eq(200)
      expect(JSON.parse(raw)).to eq({ "ok" => true })
    end
  end

  describe "#scoped_meetings" do
    let(:user) { create(:user) }
    let(:project_a) { create(:project) }
    let(:project_b) { create(:project) }

    before do
      create(:project_membership, user: user, project: project_a, role: "member")
      create(:project_membership, user: user, project: project_b, role: "member")
    end

    def build_controller(token)
      controller = described_class.new
      controller.instance_variable_set(:@api_token, token)
      controller.instance_variable_set(:@current_api_user, token.user)
      controller
    end

    it "project_ids 제한이 있으면 다른 프로젝트 회의를 제외한다" do
      m_a = create(:meeting, project: project_a, creator: user, shared: true)
      m_b = create(:meeting, project: project_b, creator: user, shared: true)
      token = create(:api_token, user: user, project_ids: [ project_a.id ])

      result = build_controller(token).send(:scoped_meetings)

      expect(result).to include(m_a)
      expect(result).not_to include(m_b)
    end

    it "project_ids가 []이면 무제한과 동일하게 전 프로젝트를 포함한다" do
      m_a = create(:meeting, project: project_a, creator: user, shared: true)
      m_b = create(:meeting, project: project_b, creator: user, shared: true)
      token = create(:api_token, user: user, project_ids: [])

      result = build_controller(token).send(:scoped_meetings)

      expect(result).to include(m_a, m_b)
    end

    it "folder_ids 제한은 하위 폴더(subtree) 회의를 포함하고 그 밖은 제외한다" do
      root = create(:folder, project: project_a)
      leaf = create(:folder, project: project_a, parent: root)
      m_in_leaf = create(:meeting, project: project_a, creator: user, folder: leaf, shared: true)
      m_outside = create(:meeting, project: project_a, creator: user, shared: true) # folder_id nil
      token = create(:api_token, user: user, folder_ids: [ root.id ])

      result = build_controller(token).send(:scoped_meetings)

      expect(result).to include(m_in_leaf)
      expect(result).not_to include(m_outside)
    end
  end
end
