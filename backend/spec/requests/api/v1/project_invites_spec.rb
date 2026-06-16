require "rails_helper"

RSpec.describe "Api::V1::ProjectInvites", type: :request do
  let(:admin) { create(:user) }
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
end
