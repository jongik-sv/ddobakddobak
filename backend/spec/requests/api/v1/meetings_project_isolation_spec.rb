require "rails_helper"

RSpec.describe "Api::V1::Meetings project 격리", type: :request do
  let(:owner) { create(:user) }
  let(:outsider) { create(:user) }
  let(:project) { create(:project) }
  let!(:m) { create(:meeting, project: project, creator: owner, shared: true) }

  # meeting 팩토리가 owner 를 project 멤버로 자동 등록하므로(현실 반영),
  # 여기선 role 을 admin 으로 승격만 한다(중복 생성 방지).
  before do
    ProjectMembership.find_or_create_by!(user: owner, project: project) { |pm| pm.role = "admin" }
                     .update!(role: "admin")
  end

  it "비멤버는 공유 회의라도 403" do
    login_as(outsider)
    get "/api/v1/meetings/#{m.id}"
    expect(response).to have_http_status(:forbidden)
  end

  it "멤버는 200" do
    create(:project_membership, user: outsider, project: project, role: "member")
    login_as(outsider)
    get "/api/v1/meetings/#{m.id}"
    expect(response).to have_http_status(:ok)
  end

  describe "시스템 admin override와 개인 프로젝트" do
    let(:sys_admin) { create(:user, :admin) }

    it "admin은 남의 개인 프로젝트 회의를 못 본다(403)" do
      other_personal = outsider.projects.find_by(personal: true)
      personal_meeting = create(:meeting, project: other_personal, creator: outsider, shared: true)
      login_as(sys_admin)
      get "/api/v1/meetings/#{personal_meeting.id}"
      expect(response).to have_http_status(:forbidden)
    end

    it "admin은 남의 팀 프로젝트 회의를 본다(200)" do
      login_as(sys_admin)
      get "/api/v1/meetings/#{m.id}"
      expect(response).to have_http_status(:ok)
    end
  end

  describe "POST /api/v1/meetings/move_to_folder 교차 프로젝트 가드" do
    let(:other_project) { create(:project) }
    let!(:other_folder) { create(:folder, project: other_project) }

    before { create(:project_membership, user: owner, project: other_project, role: "admin") }

    it "다른 프로젝트의 폴더로 이동하면 403" do
      login_as(owner)
      post "/api/v1/meetings/move_to_folder",
           params: { meeting_ids: [m.id], folder_id: other_folder.id }
      expect(response).to have_http_status(:forbidden)
      expect(m.reload.folder_id).to be_nil
    end

    it "같은 프로젝트의 폴더로는 이동 가능" do
      same_folder = create(:folder, project: project)
      login_as(owner)
      post "/api/v1/meetings/move_to_folder",
           params: { meeting_ids: [m.id], folder_id: same_folder.id }
      expect(response).to have_http_status(:ok)
      expect(m.reload.folder_id).to eq(same_folder.id)
    end
  end
end
