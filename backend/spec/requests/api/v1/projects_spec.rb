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
        json = response.parsed_body
        # 신규 유저는 개인 프로젝트(personal)가 자동 생성되므로 그것을 제외하고 검증한다.
        personal_id = user.projects.find_by(personal: true).id
        shared = json.reject { |p| p["id"] == personal_id }
        expect(shared.length).to eq(1)
        expect(shared.first["name"]).to eq(project.name)
        expect(shared.first["role"]).to eq("admin")
        expect(shared.first["member_count"]).to eq(1)
      end

      it "returns only the personal project when no other projects" do
        get "/api/v1/projects"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        personal_id = user.projects.find_by(personal: true).id
        expect(json.map { |p| p["id"] }).to eq([personal_id])
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
        json = response.parsed_body
        expect(json["project"]["name"]).to eq("Dev Project")
        expect(json["project"]["role"]).to eq("admin")
        expect(json["project"]["member_count"]).to eq(1)

        membership = ProjectMembership.last
        expect(membership.user).to eq(user)
        expect(membership.role).to eq("admin")
      end

      it "returns 422 when name is blank" do
        post "/api/v1/projects", params: { name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  describe "POST /api/v1/projects/:id/invite" do
    let!(:project) { create(:project, creator: user) }
    let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

    context "as admin" do
      it "adds the user to the project as member" do
        other_user # 개인 프로젝트 멤버십(자동 생성)이 측정에 끼지 않도록 먼저 생성
        expect {
          post "/api/v1/projects/#{project.id}/invite",
               params: { email: other_user.email },
               as: :json
        }.to change(ProjectMembership, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["membership"]["role"]).to eq("member")

        membership = ProjectMembership.find_by(user: other_user, project: project)
        expect(membership).to be_present
        expect(membership.role).to eq("member")
      end

      it "returns 404 when email not found" do
        post "/api/v1/projects/#{project.id}/invite",
             params: { email: "nobody@example.com" },
             as: :json
        expect(response).to have_http_status(:not_found)
      end

      it "returns 422 when user already in project" do
        create(:project_membership, user: other_user, project: project, role: "member")
        post "/api/v1/projects/#{project.id}/invite",
             params: { email: other_user.email },
             as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
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
  end
end
