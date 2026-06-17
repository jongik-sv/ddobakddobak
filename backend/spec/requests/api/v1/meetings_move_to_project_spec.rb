require "rails_helper"

RSpec.describe "POST /api/v1/meetings/move_to_project", type: :request do
  let(:owner) { create(:user) }
  let(:source) { create(:project) }
  let(:target) { create(:project) }
  let!(:m) { create(:meeting, project: source, creator: owner, folder: create(:folder, project: source)) }

  before do
    ProjectMembership.find_or_create_by!(user: owner, project: source) { |pm| pm.role = "admin" }
  end

  def move(params)
    post "/api/v1/meetings/move_to_project", params: params
  end

  context "원본 소유 + 대상 멤버" do
    before { create(:project_membership, user: owner, project: target, role: "member") }

    it "project_id 변경 + folder_id nil + moved 수 반환" do
      login_as(owner)
      move(meeting_ids: [m.id], target_project_id: target.id)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["moved"]).to eq(1)
      expect(m.reload.project_id).to eq(target.id)
      expect(m.reload.folder_id).to be_nil
    end
  end

  it "대상 비멤버면 403, 미변경" do
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "비소유 회의는 editable_by 스코프로 제외(moved 0)" do
    other = create(:user)
    create(:project_membership, user: other, project: source, role: "member")
    create(:project_membership, user: other, project: target, role: "member")
    login_as(other)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)["moved"]).to eq(0)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "잠긴 회의 포함 시 403" do
    create(:project_membership, user: owner, project: target, role: "member")
    m.update!(locked_at: Time.current)
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "시스템 admin은 비멤버 대상도 허용(override)" do
    admin = create(:user, role: "admin")
    login_as(admin)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(m.reload.project_id).to eq(target.id)
  end

  it "meeting_ids 비면 422" do
    create(:project_membership, user: owner, project: target, role: "member")
    login_as(owner)
    move(meeting_ids: [], target_project_id: target.id)
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "대상 프로젝트 없으면 404" do
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: 999999)
    expect(response).to have_http_status(:not_found)
  end
end
