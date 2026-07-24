require "rails_helper"

# idea 44: 폴더 협업자 CRUD + 하위 회의로의 실시간 상속.
RSpec.describe "Api::V1::Folders collaborators", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let!(:owner_membership) { create(:project_membership, user: owner, project: project, role: "member") }
  let!(:folder) { create(:folder, project: project) }
  let!(:folder_meeting) { create(:meeting, :private_meeting, project: project, creator: owner, folder: folder) }
  let(:member) do
    u = create(:user)
    create(:project_membership, user: u, project: project, role: "member")
    u
  end
  let(:outsider) { create(:user) }

  describe "POST/DELETE /api/v1/folders/:id/collaborators" do
    it "폴더 내 회의 소유자(Folder#editable_by? true)는 추가 가능(201)" do
      login_as(owner)
      post "/api/v1/folders/#{folder.id}/collaborators", params: { user_id: member.id }, as: :json

      expect(response).to have_http_status(:created)
      expect(FolderCollaborator.exists?(folder_id: folder.id, user_id: member.id)).to be true
    end

    it "무관한 사용자는 403" do
      unrelated = create(:user)
      create(:project_membership, user: unrelated, project: project, role: "member")
      login_as(unrelated)

      post "/api/v1/folders/#{folder.id}/collaborators", params: { user_id: member.id }, as: :json

      expect(response).to have_http_status(:forbidden)
    end

    it "프로젝트 비멤버 대상이면 422" do
      login_as(owner)
      post "/api/v1/folders/#{folder.id}/collaborators", params: { user_id: outsider.id }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "소유자는 제거 가능(204)" do
      FolderCollaborator.create!(folder: folder, user: member)
      login_as(owner)

      delete "/api/v1/folders/#{folder.id}/collaborators/#{member.id}"

      expect(response).to have_http_status(:no_content)
      expect(FolderCollaborator.exists?(folder_id: folder.id, user_id: member.id)).to be false
    end

    it "존재하지 않는 대상은 404" do
      login_as(owner)
      delete "/api/v1/folders/#{folder.id}/collaborators/#{member.id}"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /api/v1/folders/:id/collaborators" do
    it "직접/조상상속 구분 응답(child 폴더 내 회의 소유자=editable_by? true인 사용자가 조회)" do
      root = create(:folder, project: project)
      child = create(:folder, project: project, parent: root)
      # authorize_folder_edit!(=Folder#editable_by?)는 "그 폴더 직속 회의의 creator"만 통과시킨다
      # (조상 폴더 편집권은 상속되지 않음) — owner가 child에 접근 가능하려면 child 직속 회의가 필요.
      create(:meeting, :private_meeting, project: project, creator: owner, folder: child)
      FolderCollaborator.create!(folder: root, user: member)
      direct_user = create(:user)
      create(:project_membership, user: direct_user, project: project, role: "member")
      FolderCollaborator.create!(folder: child, user: direct_user)

      login_as(owner)
      get "/api/v1/folders/#{child.id}/collaborators"

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["direct"].map { |c| c["user_id"] }).to eq([ direct_user.id ])
      expect(body["inherited"].map { |c| c["user_id"] }).to eq([ member.id ])
      expect(body["inherited"].first["folder_id"]).to eq(root.id)
    end

    it "프로젝트 비멤버(outsider)는 403이며 협업자 PII가 노출되지 않는다 — IDOR 회귀 방지" do
      FolderCollaborator.create!(folder: folder, user: member)
      login_as(outsider)

      get "/api/v1/folders/#{folder.id}/collaborators"

      expect(response).to have_http_status(:forbidden)
      expect(response.body).not_to include(member.email)
      expect(response.body).not_to include(member.name)
    end

    it "프로젝트 멤버지만 이 폴더에 대해 editable_by?가 아닌 일반 멤버는 403" do
      FolderCollaborator.create!(folder: folder, user: member)
      other_member = create(:user)
      create(:project_membership, user: other_member, project: project, role: "member")
      login_as(other_member)

      get "/api/v1/folders/#{folder.id}/collaborators"

      expect(response).to have_http_status(:forbidden)
    end

    it "폴더 내 회의 소유자(editable_by? true)는 200" do
      login_as(owner)
      get "/api/v1/folders/#{folder.id}/collaborators"
      expect(response).to have_http_status(:ok)
    end
  end

  describe "폴더 협업자 변경이 하위 기존 회의에 즉시(스냅샷 아님) 반영됨" do
    it "협업자 추가 전엔 403, 추가 후 재요청하면 200" do
      login_as(member)
      get "/api/v1/meetings/#{folder_meeting.id}"
      expect(response).to have_http_status(:forbidden)

      FolderCollaborator.create!(folder: folder, user: member)

      get "/api/v1/meetings/#{folder_meeting.id}"
      expect(response).to have_http_status(:ok)
    end

    it "협업자 제거 후엔 재요청하면 403으로 전환된다(역방향, 스냅샷 아님 확인)" do
      collab = FolderCollaborator.create!(folder: folder, user: member)
      login_as(member)
      get "/api/v1/meetings/#{folder_meeting.id}"
      expect(response).to have_http_status(:ok)

      collab.destroy

      get "/api/v1/meetings/#{folder_meeting.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end
end
