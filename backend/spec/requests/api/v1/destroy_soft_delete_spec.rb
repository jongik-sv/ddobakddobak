require "rails_helper"

RSpec.describe "Destroy soft-delete", type: :request do
  # 팀 프로젝트 관리(삭제)는 시스템 manager 이상 — 행위자 승격 (역할 3단계 규칙)
  let(:user) { create(:user, :manager) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  describe "DELETE /api/v1/meetings/:id" do
    it "soft-deletes the meeting instead of hard-destroying it" do
      meeting = create(:meeting, project: project, creator: user)

      delete "/api/v1/meetings/#{meeting.id}"

      expect(response).to have_http_status(:no_content)
      expect(Meeting.exists?(meeting.id)).to be true
      expect(meeting.reload.trashed?).to be true
    end
  end

  describe "DELETE /api/v1/folders/:id" do
    it "soft-deletes the folder instead of hard-destroying it" do
      folder = create(:folder, project: project)
      create(:meeting, project: project, creator: user, folder: folder)

      delete "/api/v1/folders/#{folder.id}"

      expect(response).to have_http_status(:no_content)
      expect(Folder.exists?(folder.id)).to be true
      expect(folder.reload.trashed?).to be true
    end
  end

  describe "DELETE /api/v1/projects/:id" do
    it "soft-deletes a non-empty (non-personal) project" do
      target = create(:project, creator: user, personal: false)
      create(:project_membership, user: user, project: target, role: "admin")
      create(:meeting, project: target, creator: user)

      delete "/api/v1/projects/#{target.id}"

      expect(response).to have_http_status(:no_content)
      expect(Project.exists?(target.id)).to be true
      expect(target.reload.trashed?).to be true
    end
  end
end
