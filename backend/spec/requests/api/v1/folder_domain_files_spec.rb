require "rails_helper"

RSpec.describe "Api::V1 folder domain files", type: :request do
  let(:owner) { create(:user) }
  let(:other) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let!(:folder) { create(:folder, project: project) }
  let!(:file_a) { create(:domain_file, name: "A사전", creator: owner) }
  let!(:file_b) { create(:domain_file, name: "B사전", creator: owner) }

  before do
    # folder.editable_by? 는 폴더에 직속한 회의의 creator 여야 true(폴더 자체엔 소유 컬럼이 없음).
    create(:meeting, creator: owner, folder_id: folder.id, project: project)
  end

  describe "GET /api/v1/folders/:id/domain_files" do
    before { DomainFileLink.create!(owner: folder, domain_file: file_a) }

    it "editable_by? 통과 사용자는 링크된 파일 목록 조회 가능" do
      login_as(owner)
      get "/api/v1/folders/#{folder.id}/domain_files"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["domain_files"].map { |f| f["id"] }).to eq([ file_a.id ])
    end

    it "editable_by? 미통과 사용자는 403" do
      login_as(other)
      get "/api/v1/folders/#{folder.id}/domain_files"
      expect(response).to have_http_status(:forbidden)
    end

    it "응답에 inherited 키를 포함한다(기본 빈 배열)" do
      login_as(owner)
      get "/api/v1/folders/#{folder.id}/domain_files"
      expect(response.parsed_body["inherited"]).to eq([])
    end
  end

  describe "GET inherited (UX 증분 C: 프로젝트 + 조상 폴더 링크)" do
    it "프로젝트에 링크된 파일이 source: project로 노출된다" do
      project_file = create(:domain_file, name: "프로젝트사전", creator: owner)
      DomainFileLink.create!(owner: project, domain_file: project_file)

      login_as(owner)
      get "/api/v1/folders/#{folder.id}/domain_files"
      inherited = response.parsed_body["inherited"]

      expect(inherited.map { |f| f["id"] }).to eq([ project_file.id ])
      expect(inherited.first["source"]).to eq("project")
      expect(inherited.first["owner_name"]).to eq(project.name)
    end

    it "조상 폴더에 링크된 파일이 source: folder로 노출된다" do
      child = create(:folder, project: project, parent: folder)
      create(:meeting, creator: owner, folder_id: child.id, project: project)
      parent_file = create(:domain_file, name: "부모폴더사전", creator: owner)
      DomainFileLink.create!(owner: folder, domain_file: parent_file)

      login_as(owner)
      get "/api/v1/folders/#{child.id}/domain_files"
      inherited = response.parsed_body["inherited"]

      expect(inherited.map { |f| f["id"] }).to eq([ parent_file.id ])
      expect(inherited.first["source"]).to eq("folder")
      expect(inherited.first["owner_name"]).to eq(folder.name)
    end
  end

  describe "PUT /api/v1/folders/:id/domain_files" do
    it "editable_by? 통과 사용자는 세트 교체 가능" do
      login_as(owner)
      put "/api/v1/folders/#{folder.id}/domain_files", params: { domain_file_ids: [ file_a.id, file_b.id ] }
      expect(response).to have_http_status(:ok)
      expect(folder.reload.domain_files.pluck(:id)).to contain_exactly(file_a.id, file_b.id)
    end

    it "빈 배열은 전체 해제" do
      DomainFileLink.create!(owner: folder, domain_file: file_a)
      login_as(owner)
      put "/api/v1/folders/#{folder.id}/domain_files", params: { domain_file_ids: [] }
      expect(response).to have_http_status(:ok)
      expect(folder.reload.domain_files).to be_empty
    end

    it "editable_by? 미통과 사용자는 403" do
      login_as(other)
      put "/api/v1/folders/#{folder.id}/domain_files", params: { domain_file_ids: [ file_a.id ] }
      expect(response).to have_http_status(:forbidden)
    end

    it "접근 불가한 id 포함 시 422" do
      login_as(owner)
      put "/api/v1/folders/#{folder.id}/domain_files", params: { domain_file_ids: [ file_a.id, 999999 ] }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(folder.reload.domain_files).to be_empty
    end

    it "프로젝트에 이미 링크된 id는 조용히 무시되고 실제 상태를 반환한다 (UX 증분 C)" do
      project_file = create(:domain_file, name: "프로젝트사전", creator: owner)
      DomainFileLink.create!(owner: project, domain_file: project_file)

      login_as(owner)
      put "/api/v1/folders/#{folder.id}/domain_files", params: { domain_file_ids: [ file_a.id, project_file.id ] }
      expect(response).to have_http_status(:ok)

      body = response.parsed_body
      expect(body["domain_files"].map { |f| f["id"] }).to eq([ file_a.id ])
      expect(folder.reload.domain_files.pluck(:id)).to eq([ file_a.id ])
    end

    it "조상 폴더에 이미 링크된 id는 조용히 무시된다 (UX 증분 C)" do
      child = create(:folder, project: project, parent: folder)
      create(:meeting, creator: owner, folder_id: child.id, project: project)
      parent_file = create(:domain_file, name: "부모폴더사전", creator: owner)
      DomainFileLink.create!(owner: folder, domain_file: parent_file)

      login_as(owner)
      put "/api/v1/folders/#{child.id}/domain_files", params: { domain_file_ids: [ file_a.id, parent_file.id ] }
      expect(response).to have_http_status(:ok)
      expect(child.reload.domain_files.pluck(:id)).to eq([ file_a.id ])
    end
  end
end
