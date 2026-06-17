require "rails_helper"

RSpec.describe "POST /api/v1/projects/:id/members", type: :request do
  let(:admin_user) { create(:user) }
  let(:project) { create(:project) }
  let!(:target) { create(:user, email: "newbie@example.com", name: "뉴비") }

  before do
    ProjectMembership.find_or_create_by!(user: admin_user, project: project) { |pm| pm.role = "admin" }
  end

  def add(params)
    post "/api/v1/projects/#{project.id}/members", params: params
  end

  it "이메일로 기존 사용자를 멤버로 추가" do
    login_as(admin_user)
    add(email: "newbie@example.com")
    expect(response).to have_http_status(:created)
    body = JSON.parse(response.body)
    expect(body["member"]["email"]).to eq("newbie@example.com")
    expect(body["member"]["role"]).to eq("member")
    expect(project.reload.project_memberships.exists?(user_id: target.id)).to be true
  end

  it "이메일 대소문자·공백 무시하고 매칭" do
    target
    login_as(admin_user)
    add(email: "  NewBie@Example.com  ")
    expect(response).to have_http_status(:created)
    expect(project.reload.project_memberships.exists?(user_id: target.id)).to be true
  end

  it "존재하지 않는 이메일이면 404" do
    login_as(admin_user)
    add(email: "nobody@example.com")
    expect(response).to have_http_status(:not_found)
  end

  it "이미 멤버면 멱등(200, 중복 생성 안 함)" do
    create(:project_membership, user: target, project: project, role: "member")
    login_as(admin_user)
    expect { add(email: "newbie@example.com") }.not_to change { project.project_memberships.count }
    expect(response).to have_http_status(:ok)
  end

  it "프로젝트 admin이 아니면 403" do
    stranger = create(:user)
    create(:project_membership, user: stranger, project: project, role: "member")
    login_as(stranger)
    add(email: "newbie@example.com")
    expect(response).to have_http_status(:forbidden)
  end

  it "email 누락이면 422" do
    login_as(admin_user)
    add({})
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
