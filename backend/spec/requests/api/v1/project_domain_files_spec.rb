require "rails_helper"

RSpec.describe "Api::V1 project domain files", type: :request do
  let(:admin_member) { create(:user) }
  let(:regular_member) { create(:user) }
  let(:stranger) { create(:user) }
  let(:project) { create(:project, creator: admin_member) }
  let!(:file_a) { create(:domain_file, name: "A사전", creator: admin_member) }
  let!(:file_b) { create(:domain_file, name: "B사전", creator: admin_member) }

  before do
    ProjectMembership.find_or_create_by!(project: project, user: admin_member) { |pm| pm.role = "admin" }
    ProjectMembership.find_or_create_by!(project: project, user: regular_member) { |pm| pm.role = "member" }
  end

  describe "GET /api/v1/projects/:id/domain_files" do
    before { DomainFileLink.create!(owner: project, domain_file: file_a) }

    it "프로젝트 멤버는 링크된 파일 목록을 조회 가능" do
      login_as(regular_member)
      get "/api/v1/projects/#{project.id}/domain_files"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["domain_files"].map { |f| f["id"] }).to eq([ file_a.id ])
    end

    it "DomainFileSummary 포맷(editable 포함)" do
      login_as(regular_member)
      get "/api/v1/projects/#{project.id}/domain_files"
      entry = response.parsed_body["domain_files"].first
      expect(entry.keys).to match_array(%w[id name project_id updated_at editable])
    end

    it "비멤버는 403" do
      login_as(stranger)
      get "/api/v1/projects/#{project.id}/domain_files"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PUT /api/v1/projects/:id/domain_files" do
    it "프로젝트 관리자는 세트 교체 가능" do
      login_as(admin_member)
      put "/api/v1/projects/#{project.id}/domain_files", params: { domain_file_ids: [ file_a.id, file_b.id ] }
      expect(response).to have_http_status(:ok)
      expect(project.reload.domain_files.pluck(:id)).to contain_exactly(file_a.id, file_b.id)
      expect(response.parsed_body["domain_files"].map { |f| f["id"] }).to contain_exactly(file_a.id, file_b.id)
    end

    it "빈 배열은 전체 해제" do
      DomainFileLink.create!(owner: project, domain_file: file_a)
      login_as(admin_member)
      put "/api/v1/projects/#{project.id}/domain_files", params: { domain_file_ids: [] }
      expect(response).to have_http_status(:ok)
      expect(project.reload.domain_files).to be_empty
    end

    it "일반 멤버(admin 아님)는 403" do
      login_as(regular_member)
      put "/api/v1/projects/#{project.id}/domain_files", params: { domain_file_ids: [ file_a.id ] }
      expect(response).to have_http_status(:forbidden)
    end

    it "접근 불가한 id 포함 시 422" do
      login_as(admin_member)
      put "/api/v1/projects/#{project.id}/domain_files", params: { domain_file_ids: [ file_a.id, 999999 ] }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(project.reload.domain_files).to be_empty
    end
  end
end
