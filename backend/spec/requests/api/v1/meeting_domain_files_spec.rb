require "rails_helper"

RSpec.describe "Api::V1 meeting domain files", type: :request do
  let(:owner) { create(:user) }
  let(:other) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let!(:meeting) { create(:meeting, creator: owner, project: project) }
  let!(:file_a) { create(:domain_file, name: "A사전", creator: owner) }
  let!(:file_b) { create(:domain_file, name: "B사전", creator: owner) }

  describe "GET /api/v1/meetings/:id/domain_files" do
    before { DomainFileLink.create!(owner: meeting, domain_file: file_b) }

    it "selected는 회의 자체 링크를 id순으로 반환" do
      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["selected"].map { |f| f["id"] }).to eq([ file_b.id ])
      expect(body["inherited"]).to eq([])
    end

    it "DomainFileSummary 포맷(editable 포함)으로 반환한다" do
      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      entry = response.parsed_body["selected"].first
      expect(entry.keys).to match_array(%w[id name project_id updated_at editable])
      expect(entry["editable"]).to be true
    end

    it "폴더/프로젝트에 링크된 파일은 inherited에 source·owner_name과 함께 노출" do
      folder = create(:folder, project: project)
      meeting.update!(folder: folder)
      folder_file = create(:domain_file, name: "폴더사전", creator: owner)
      project_file = create(:domain_file, name: "프로젝트사전", creator: owner)
      DomainFileLink.create!(owner: folder, domain_file: folder_file)
      DomainFileLink.create!(owner: project, domain_file: project_file)

      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      inherited = response.parsed_body["inherited"]

      expect(inherited.map { |f| f["id"] }).to contain_exactly(folder_file.id, project_file.id)
      folder_entry = inherited.find { |f| f["id"] == folder_file.id }
      expect(folder_entry["source"]).to eq("folder")
      expect(folder_entry["owner_name"]).to eq(folder.name)
      project_entry = inherited.find { |f| f["id"] == project_file.id }
      expect(project_entry["source"]).to eq("project")
      expect(project_entry["owner_name"]).to eq(project.name)
    end

    it "회의가 직접 선택한 파일은 프로젝트/폴더에도 링크되어 있어도 inherited에 중복 노출되지 않는다" do
      DomainFileLink.create!(owner: project, domain_file: file_b)

      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      body = response.parsed_body

      expect(body["selected"].map { |f| f["id"] }).to eq([ file_b.id ])
      expect(body["inherited"]).to be_empty
    end

    it "회의 열람 권한이 없으면 403" do
      login_as(other)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PUT /api/v1/meetings/:id/domain_files" do
    it "선택을 전체 교체한다" do
      DomainFileLink.create!(owner: meeting, domain_file: file_a)
      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_b.id ] }
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.domain_files.pluck(:id)).to eq([ file_b.id ])
      expect(response.parsed_body["selected"].map { |f| f["id"] }).to eq([ file_b.id ])
    end

    it "빈 배열은 전체 해제" do
      DomainFileLink.create!(owner: meeting, domain_file: file_a)
      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [] }
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.domain_files).to be_empty
    end

    it "접근 불가/존재하지 않는 id 포함 시 422" do
      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_a.id, 999999 ] }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(meeting.reload.domain_files).to be_empty
    end

    it "회의 자체 링크만 교체하고 폴더/프로젝트 상속분은 영향받지 않는다" do
      project_file = create(:domain_file, name: "프로젝트사전", creator: owner)
      DomainFileLink.create!(owner: project, domain_file: project_file)

      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_a.id ] }
      expect(response).to have_http_status(:ok)

      body = response.parsed_body
      expect(body["selected"].map { |f| f["id"] }).to eq([ file_a.id ])
      expect(body["inherited"].map { |f| f["id"] }).to eq([ project_file.id ])
    end

    it "잠긴 회의는 403(reject_if_locked!)" do
      meeting.update!(locked_at: Time.current)
      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_a.id ] }
      expect(response).to have_http_status(:forbidden)
    end

    it "소유자가 아니면 403" do
      login_as(other)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_a.id ] }
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/v1/meetings/:id/extract_terms" do
    it "요약이 없으면 422" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/extract_terms"
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("추출할 요약이 없습니다")
    end

    it "서비스 성공 시 추출된 용어 반환" do
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "본문")
      meeting.update!(status: "completed")
      allow_any_instance_of(DomainTermExtractionService).to receive(:call)
        .and_return([ { "term" => "CTQ", "category" => "약어", "definition" => "Critical To Quality" } ])

      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/extract_terms"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["terms"]).to eq([ { "term" => "CTQ", "category" => "약어", "definition" => "Critical To Quality" } ])
    end

    it "서비스가 nil 반환 시 422" do
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "본문")
      meeting.update!(status: "completed")
      allow_any_instance_of(DomainTermExtractionService).to receive(:call).and_return(nil)

      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/extract_terms"
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("용어 추출에 실패했습니다")
    end

    it "잠긴 회의는 403(reject_if_locked!)" do
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "본문")
      meeting.update!(status: "completed", locked_at: Time.current)

      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/extract_terms"
      expect(response).to have_http_status(:forbidden)
    end

    it "소유자가 아니면 403" do
      login_as(other)
      post "/api/v1/meetings/#{meeting.id}/extract_terms"
      expect(response).to have_http_status(:forbidden)
    end
  end
end
