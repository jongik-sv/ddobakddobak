require "rails_helper"

RSpec.describe "Api::V1::Projects", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  before { login_as(user) }

  describe "GET /api/v1/projects" do
    context "when authenticated" do
      it "returns projects the user belongs to" do
        project = create(:project, creator: user)
        create(:project_membership, user: user, project: project, role: "admin")
        other_project = create(:project, creator: other_user)
        create(:project_membership, user: other_user, project: other_project, role: "admin")

        get "/api/v1/projects"

        expect(response).to have_http_status(:ok)
        projects = response.parsed_body["projects"]
        # 신규 유저는 개인 프로젝트(personal)가 자동 생성되므로 그것을 제외하고 검증한다.
        personal_id = user.projects.find_by(personal: true).id
        shared = projects.reject { |p| p["id"] == personal_id }
        expect(shared.length).to eq(1)
        expect(shared.first["name"]).to eq(project.name)
        expect(shared.first["role"]).to eq("admin")
        expect(shared.first["member_count"]).to eq(1)
      end

      it "returns only the personal project when no other projects" do
        get "/api/v1/projects"

        expect(response).to have_http_status(:ok)
        projects = response.parsed_body["projects"]
        personal_id = user.projects.find_by(personal: true).id
        expect(projects.map { |p| p["id"] }).to eq([personal_id])
      end

      it "프로젝트 JSON에 owner(creator 이름)를 포함한다" do
        project = create(:project, creator: user)
        create(:project_membership, user: user, project: project, role: "admin")

        get "/api/v1/projects"

        expect(response).to have_http_status(:ok)
        projects = response.parsed_body["projects"]
        personal_id = user.projects.find_by(personal: true).id
        shared = projects.reject { |p| p["id"] == personal_id }
        expect(shared.first["owner"]).to eq(user.name)
      end
    end
  end

  describe "POST /api/v1/projects" do
    context "when authenticated" do
      it "creates a project and adds creator as admin" do
        expect {
          post "/api/v1/projects", params: { name: "Dev Project" }, as: :json
        }.to change(Project, :count).by(1).and change(ProjectMembership, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body["project"]
        expect(json["name"]).to eq("Dev Project")
        expect(json["role"]).to eq("admin")
        expect(json["member_count"]).to eq(1)

        membership = ProjectMembership.last
        expect(membership.user).to eq(user)
        expect(membership.role).to eq("admin")
      end

      it "returns 422 when name is blank" do
        post "/api/v1/projects", params: { name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    it "프로젝트를 만들고 생성자를 admin 멤버로 넣는다" do
      post "/api/v1/projects", params: { name: "마케팅", icon_type: "emoji", icon_value: "📣" }, as: :json
      expect(response).to have_http_status(:created)
      json = response.parsed_body["project"]
      expect(json["name"]).to eq("마케팅")
      expect(Project.find(json["id"]).admin?(user)).to be true
    end
  end

  describe "GET /api/v1/projects/:id" do
    let!(:project) { create(:project, creator: user) }
    let!(:membership) { create(:project_membership, user: user, project: project, role: "admin") }

    it "멤버는 프로젝트 상세를 조회한다" do
      get "/api/v1/projects/#{project.id}"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["project"]["id"]).to eq(project.id)
    end

    it "비멤버는 403" do
      login_as(other_user)
      get "/api/v1/projects/#{project.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/v1/projects/:id" do
    let!(:project) { create(:project, creator: user) }
    let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

    it "admin 은 프로젝트를 수정한다" do
      patch "/api/v1/projects/#{project.id}", params: { name: "변경됨" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(project.reload.name).to eq("변경됨")
    end

    it "비admin 멤버는 수정 불가(403)" do
      create(:project_membership, user: other_user, project: project, role: "member")
      login_as(other_user)
      patch "/api/v1/projects/#{project.id}", params: { name: "해킹" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(project.reload.name).not_to eq("해킹")
    end
  end

  describe "DELETE /api/v1/projects/:id" do
    it "비어있는 비개인 프로젝트는 삭제" do
      project = create(:project)
      create(:project_membership, user: user, project: project, role: "admin")
      delete "/api/v1/projects/#{project.id}", as: :json
      expect(response).to have_http_status(:no_content)
    end
    it "회의가 있으면 409" do
      project = create(:project)
      create(:project_membership, user: user, project: project, role: "admin")
      create(:meeting, project: project, creator: user)
      delete "/api/v1/projects/#{project.id}", as: :json
      expect(response).to have_http_status(:conflict)
    end
    it "개인 프로젝트는 삭제 불가(409)" do
      personal = user.projects.find_by(personal: true)
      delete "/api/v1/projects/#{personal.id}", as: :json
      expect(response).to have_http_status(:conflict)
    end
  end

  describe "GET /api/v1/projects/:id/members" do
    let!(:project) { create(:project, creator: user) }
    let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }
    let!(:member_membership) { create(:project_membership, user: other_user, project: project, role: "member") }

    it "admin 은 멤버 목록을 본다" do
      get "/api/v1/projects/#{project.id}/members"
      expect(response).to have_http_status(:ok)
      members = response.parsed_body["members"]
      expect(members.map { |m| m["user_id"] }).to match_array([user.id, other_user.id])
    end
  end

  describe "PATCH /api/v1/projects/:id/members/:user_id" do
    let!(:project) { create(:project, creator: user) }
    let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }
    let!(:member_membership) { create(:project_membership, user: other_user, project: project, role: "member") }

    it "admin 은 멤버 역할을 변경한다" do
      patch "/api/v1/projects/#{project.id}/members/#{other_user.id}",
            params: { role: "admin" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(member_membership.reload.role).to eq("admin")
    end

    it "멤버가 없으면 404" do
      patch "/api/v1/projects/#{project.id}/members/999999", params: { role: "admin" }, as: :json
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/v1/projects/:id/members/:user_id" do
    let!(:project) { create(:project, creator: user) }
    let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }
    let!(:member_membership) { create(:project_membership, user: other_user, project: project, role: "member") }

    context "as admin" do
      it "removes the member from the project" do
        expect {
          delete "/api/v1/projects/#{project.id}/members/#{other_user.id}"
        }.to change(ProjectMembership, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end

      it "returns 404 when member not found" do
        delete "/api/v1/projects/#{project.id}/members/999"
        expect(response).to have_http_status(:not_found)
      end
    end

    context "as non-admin member" do
      it "is forbidden (403)" do
        create(:project_membership, user: create(:user), project: project, role: "member")
        member = create(:user)
        create(:project_membership, user: member, project: project, role: "member")
        login_as(member)
        delete "/api/v1/projects/#{project.id}/members/#{other_user.id}"
        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
