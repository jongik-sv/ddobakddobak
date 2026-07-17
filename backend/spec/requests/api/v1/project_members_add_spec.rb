require "rails_helper"

RSpec.describe "POST /api/v1/projects/:id/members", type: :request do
  # 팀 프로젝트 멤버 추가(add_member)는 시스템 manager 이상 + 프로젝트 admin이 필요하다.
  let(:admin_user) { create(:user, :manager) }
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

  it "name 또는 email 누락이면 422" do
    login_as(admin_user)
    add({})
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "이름이 유일하게 일치하면 멤버로 추가(201)" do
    login_as(admin_user)
    add(name: "뉴비")
    expect(response).to have_http_status(:created)
    body = JSON.parse(response.body)
    expect(body["member"]["name"]).to eq("뉴비")
    expect(project.reload.project_memberships.exists?(user_id: target.id)).to be true
  end

  it "동명이인이면 candidates 반환(200, 멤버십 생성 안 함)" do
    other = create(:user, email: "newbie2@example.com", name: "뉴비")
    login_as(admin_user)
    expect { add(name: "뉴비") }.not_to change { project.project_memberships.count }
    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    expect(body["candidates"].length).to eq(2)
    ids = body["candidates"].map { |c| c["id"] }
    expect(ids).to contain_exactly(target.id, other.id)
    body["candidates"].each do |c|
      expect(c.keys).to include("id", "name", "email")
    end
  end

  it "일치하는 이름이 없으면 404" do
    login_as(admin_user)
    add(name: "없는사람")
    expect(response).to have_http_status(:not_found)
  end

  describe "role 파라미터" do
    it "role=admin으로 비멤버를 추가하면 프로젝트 admin으로 들어간다(201)" do
      login_as(admin_user)
      add(email: "newbie@example.com", role: "admin")
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["member"]["role"]).to eq("admin")
      expect(project.reload.project_memberships.find_by(user_id: target.id).role).to eq("admin")
    end

    it "role 미전달이면 member로 들어간다" do
      login_as(admin_user)
      add(email: "newbie@example.com")
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["member"]["role"]).to eq("member")
    end

    it "잘못된 role 값은 422" do
      login_as(admin_user)
      expect { add(email: "newbie@example.com", role: "owner") }.not_to change(ProjectMembership, :count)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to be_present
    end

    it "이미 멤버인 경우 role을 지정해도 기존 역할이 바뀌지 않는다(역할 변경은 update_member 담당)" do
      create(:project_membership, user: target, project: project, role: "member")
      login_as(admin_user)
      add(email: "newbie@example.com", role: "admin")
      expect(response).to have_http_status(:ok)
      expect(project.reload.project_memberships.find_by(user_id: target.id).role).to eq("member")
    end

    it "위임 시나리오: 시스템 admin이 비멤버인 남의 팀 프로젝트에 role=admin으로 멤버를 추가할 수 있다" do
      other_owner = create(:user)
      other_team_project = create(:project, creator: other_owner, personal: false)
      create(:project_membership, user: other_owner, project: other_team_project, role: "admin")

      login_as(create(:user, :admin))
      post "/api/v1/projects/#{other_team_project.id}/members", params: { email: target.email, role: "admin" }
      expect(response).to have_http_status(:created)
      expect(other_team_project.reload.project_memberships.find_by(user_id: target.id).role).to eq("admin")
    end
  end
end
