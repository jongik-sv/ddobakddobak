require "rails_helper"

RSpec.describe "Api::V1::Invites", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner, name: "팀A") }
  let(:invite) { ProjectInvite.generate!(project: project, created_by: owner) }

  describe "GET /api/v1/invite/:code" do
    it "인증 없이 프로젝트 미리보기" do
      get "/api/v1/invite/#{invite.code}"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["project"]["name"]).to eq("팀A")
    end
    it "잘못된 코드는 404" do
      get "/api/v1/invite/zzzzzz"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/v1/invite/:code/redeem" do
    it "로그인 유저는 멤버로 합류" do
      member = create(:user)
      login_as(member)
      expect { post "/api/v1/invite/#{invite.code}/redeem", as: :json }
        .to change { project.project_memberships.count }.by(1)
      expect(response).to have_http_status(:ok)
      expect(invite.reload.use_count).to eq(1)
    end

    it "비로그인 + 가입정보 → 계정 생성 + 합류 + 토큰 발급" do
      code = invite.code # owner/project/invite 를 블록 밖에서 미리 생성(lazy let 누수 방지)
      expect {
        post "/api/v1/invite/#{code}/redeem",
             params: { name: "신규", email: "new@example.com", password: "password123" }, as: :json
      }.to change(User, :count).by(1)
      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["access_token"]).to be_present
      expect(body["refresh_token"]).to be_present
      expect(project.member?(User.find_by(email: "new@example.com"))).to be true
    end

    it "password_confirmation 불일치 → 422" do
      code = invite.code
      post "/api/v1/invite/#{code}/redeem",
           params: { name: "신규", email: "mismatch@example.com", password: "password123",
                     password_confirmation: "different123" }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "password_confirmation 일치 → 계정 생성 + 합류 + 토큰 발급" do
      code = invite.code
      expect {
        post "/api/v1/invite/#{code}/redeem",
             params: { name: "신규", email: "confirmed@example.com", password: "password123",
                       password_confirmation: "password123" }, as: :json
      }.to change(User, :count).by(1)
      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["access_token"]).to be_present
      expect(body["refresh_token"]).to be_present
      expect(project.member?(User.find_by(email: "confirmed@example.com"))).to be true
    end

    it "만료 코드는 410" do
      expired = ProjectInvite.generate!(project: project, created_by: owner, expires_at: 1.hour.ago)
      post "/api/v1/invite/#{expired.code}/redeem",
           params: { name: "x", email: "x@example.com", password: "password123" }, as: :json
      expect(response).to have_http_status(:gone)
    end

    it "개인 프로젝트 초대는 참여 불가(409, 로그인 유저)" do
      personal_owner = create(:user)
      personal = personal_owner.projects.find_by(personal: true)
      personal_invite = ProjectInvite.generate!(project: personal, created_by: personal_owner)
      member = create(:user)
      login_as(member)

      expect { post "/api/v1/invite/#{personal_invite.code}/redeem", as: :json }
        .not_to change { personal.project_memberships.count }

      expect(response).to have_http_status(:conflict)
    end

    it "개인 프로젝트 초대는 가입 시도해도 유저가 생성되지 않는다(409)" do
      personal_owner = create(:user)
      personal = personal_owner.projects.find_by(personal: true)
      personal_invite = ProjectInvite.generate!(project: personal, created_by: personal_owner)

      expect {
        post "/api/v1/invite/#{personal_invite.code}/redeem",
             params: { name: "신규", email: "blocked@example.com", password: "password123" }, as: :json
      }.not_to change(User, :count)

      expect(response).to have_http_status(:conflict)
    end
  end
end
