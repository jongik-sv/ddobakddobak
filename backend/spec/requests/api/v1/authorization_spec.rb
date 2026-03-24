require "rails_helper"

# Authorization middleware 통합 테스트
# Teams 컨트롤러를 통해 권한 제어 동작을 검증한다.
RSpec.describe "Authorization", type: :request do
  let(:admin_user)  { create(:user) }
  let(:member_user) { create(:user) }
  let(:outsider)    { create(:user) }
  let!(:team) { create(:team, creator: admin_user) }
  let!(:admin_membership)  { create(:team_membership, user: admin_user,  team: team, role: "admin") }
  let!(:member_membership) { create(:team_membership, user: member_user, team: team, role: "member") }

  def login_token(user)
    post "/api/v1/login", params: { email: user.email, password: "password123" }, as: :json
    response.parsed_body["token"]
  end

  def auth_headers(user)
    { "Authorization" => "Bearer #{login_token(user)}" }
  end

  describe "팀 기반 리소스 접근 제어" do
    context "인증되지 않은 사용자" do
      it "팀 목록 접근 시 401 반환" do
        get "/api/v1/teams"
        expect(response).to have_http_status(:unauthorized)
      end

      it "팀 초대 시 401 반환" do
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: outsider.email }, as: :json
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "다른 팀 소속 사용자 (outsider)" do
      it "팀 초대 시 403 반환" do
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: create(:user).email },
             headers: auth_headers(outsider), as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "팀원 제거 시 403 반환" do
        delete "/api/v1/teams/#{team.id}/members/#{member_user.id}",
               headers: auth_headers(outsider)
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "팀 멤버 (비-admin)" do
      it "팀원 초대 시 403 반환" do
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: outsider.email },
             headers: auth_headers(member_user), as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "팀원 제거 시 403 반환" do
        delete "/api/v1/teams/#{team.id}/members/#{admin_user.id}",
               headers: auth_headers(member_user)
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "팀 admin" do
      it "팀원 초대 성공" do
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: outsider.email },
             headers: auth_headers(admin_user), as: :json
        expect(response).to have_http_status(:created)
      end

      it "팀원 제거 성공" do
        delete "/api/v1/teams/#{team.id}/members/#{member_user.id}",
               headers: auth_headers(admin_user)
        expect(response).to have_http_status(:no_content)
      end
    end
  end

  describe "TeamAuthorizable concern" do
    it "require_team_membership!: 팀 멤버는 허용" do
      # GET /api/v1/teams는 authenticate_user!만 사용하므로, 팀 멤버 여부와 무관하게 자신의 팀 목록 반환
      get "/api/v1/teams", headers: auth_headers(member_user)
      expect(response).to have_http_status(:ok)
    end

    it "require_team_admin!: admin만 팀 관리 가능" do
      # invite는 admin만 가능
      post "/api/v1/teams/#{team.id}/invite",
           params: { email: outsider.email },
           headers: auth_headers(member_user), as: :json
      expect(response).to have_http_status(:forbidden)

      post "/api/v1/teams/#{team.id}/invite",
           params: { email: outsider.email },
           headers: auth_headers(admin_user), as: :json
      expect(response).to have_http_status(:created)
    end
  end
end
