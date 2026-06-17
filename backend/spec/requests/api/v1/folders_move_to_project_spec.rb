require "rails_helper"

RSpec.describe "POST /api/v1/folders/:id/move_to_project", type: :request do
  let(:owner) { create(:user) }
  let(:source) { create(:project) }
  let(:target) { create(:project) }
  let(:root) { create(:folder, project: source) }
  let(:child) { create(:folder, project: source, parent: root) }
  let!(:m_root) { create(:meeting, project: source, creator: owner, folder: root) }
  let!(:m_child) { create(:meeting, project: source, creator: owner, folder: child) }

  before do
    ProjectMembership.find_or_create_by!(user: owner, project: source) { |pm| pm.role = "admin" }
  end

  def move(folder, params)
    post "/api/v1/folders/#{folder.id}/move_to_project", params: params
  end

  context "권한 통과(원본 소유 + 대상 멤버)" do
    before { create(:project_membership, user: owner, project: target, role: "member") }

    it "서브트리 폴더·회의 전부 대상 project_id, 루트 parent nil, 내부구조 보존" do
      child # touch (lazy let)
      login_as(owner)
      move(root, target_project_id: target.id)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["moved_folders"]).to eq(2)
      expect(body["moved_meetings"]).to eq(2)
      expect(root.reload.project_id).to eq(target.id)
      expect(root.reload.parent_id).to be_nil
      expect(child.reload.project_id).to eq(target.id)
      expect(child.reload.parent_id).to eq(root.id)
      expect(m_root.reload.project_id).to eq(target.id)
      expect(m_root.reload.folder_id).to eq(root.id)
      expect(m_child.reload.project_id).to eq(target.id)
    end

    it "고아 폴더 미발생(자손이 원본에 남지 않음)" do
      child
      login_as(owner)
      move(root, target_project_id: target.id)
      expect(Folder.where(project_id: source.id)).to be_empty
    end

    it "자기 프로젝트로 이동하면 422" do
      login_as(owner)
      move(root, target_project_id: source.id)
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  it "원본 폴더 편집권 없으면 403" do
    stranger = create(:user)
    create(:project_membership, user: stranger, project: target, role: "member")
    login_as(stranger)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(root.reload.project_id).to eq(source.id)
  end

  it "대상 비멤버면 403" do
    login_as(owner)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(root.reload.project_id).to eq(source.id)
  end

  it "시스템 admin override" do
    admin = create(:user, role: "admin")
    login_as(admin)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(root.reload.project_id).to eq(target.id)
  end
end
