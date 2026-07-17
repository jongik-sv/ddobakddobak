require "rails_helper"

RSpec.describe "Api::V1::ProjectInvites", type: :request do
  # 초대는 팀 프로젝트 전용 — 생성엔 시스템 manager 이상이 필요하다.
  let(:admin) { create(:user, :manager) }
  let(:project) { create(:project, creator: admin) }
  before do
    create(:project_membership, user: admin, project: project, role: "admin")
    login_as(admin)
  end

  it "프로젝트 admin이 초대 코드를 만든다" do
    post "/api/v1/projects/#{project.id}/invites", params: { max_uses: 5 }, as: :json
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["invite"]["code"]).to match(/\A[a-zA-Z0-9]{6}\z/)
  end

  it "비admin 멤버는 초대 생성 불가(403)" do
    member = create(:user)
    create(:project_membership, user: member, project: project, role: "member")
    login_as(member)
    post "/api/v1/projects/#{project.id}/invites", as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "시스템 member는 프로젝트 admin이어도 초대 생성 불가(403)" do
    sys_member = create(:user)
    create(:project_membership, user: sys_member, project: project, role: "admin")
    login_as(sys_member)
    post "/api/v1/projects/#{project.id}/invites", as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "개인 프로젝트에는 초대를 만들 수 없다(409)" do
    personal = admin.projects.find_by(personal: true)

    expect {
      post "/api/v1/projects/#{personal.id}/invites", as: :json
    }.not_to change(ProjectInvite, :count)

    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body["error"]).to be_present
  end
end
