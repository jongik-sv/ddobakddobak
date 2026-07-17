require "rails_helper"

RSpec.describe "Api::V1::DomainFiles", type: :request do
  let(:creator) { create(:user) }
  let(:other)   { create(:user) }
  let(:project) { create(:project, creator: creator) }

  before do
    ProjectMembership.find_or_create_by!(project: project, user: creator) { |pm| pm.role = "member" }
  end

  describe "GET /api/v1/domain_files" do
    let!(:global_file)  { create(:domain_file, name: "전역 사전", creator: creator) }
    let!(:project_file) { create(:domain_file, :with_project, project: project, name: "프로젝트 사전", creator: creator) }
    let!(:other_project_file) { create(:domain_file, :with_project, name: "무관 프로젝트 사전", creator: other) }

    it "비멤버는 전역 파일만 조회 (accessible_by 스코프)" do
      login_as(other)
      get "/api/v1/domain_files"
      expect(response).to have_http_status(:ok)
      names = response.parsed_body["domain_files"].map { |f| f["name"] }
      expect(names).to include("전역 사전")
      expect(names).not_to include("프로젝트 사전", "무관 프로젝트 사전")
    end

    it "프로젝트 멤버는 전역 + 소속 프로젝트 파일 조회" do
      login_as(creator)
      get "/api/v1/domain_files"
      expect(response).to have_http_status(:ok)
      names = response.parsed_body["domain_files"].map { |f| f["name"] }
      expect(names).to include("전역 사전", "프로젝트 사전")
      expect(names).not_to include("무관 프로젝트 사전")
    end

    it "content 필드는 index 응답에 포함되지 않는다" do
      login_as(creator)
      get "/api/v1/domain_files"
      expect(response.parsed_body["domain_files"].first).not_to have_key("content")
    end

    it "project_id 파라미터로 전역+해당 프로젝트 필터" do
      other_membered_project = create(:project, creator: creator)
      ProjectMembership.find_or_create_by!(project: other_membered_project, user: creator) { |pm| pm.role = "member" }
      irrelevant_project_file = create(:domain_file, :with_project, project: other_membered_project, name: "다른 프로젝트 사전", creator: creator)

      login_as(creator)
      get "/api/v1/domain_files", params: { project_id: project.id }
      names = response.parsed_body["domain_files"].map { |f| f["name"] }
      expect(names).to include("전역 사전", "프로젝트 사전")
      expect(names).not_to include(irrelevant_project_file.name)
    end
  end

  describe "POST /api/v1/domain_files (JSON)" do
    it "전역 파일 생성" do
      login_as(creator)
      post "/api/v1/domain_files", params: { name: "새 사전", content: "- **CTQ** [약어]: Critical To Quality" }
      expect(response).to have_http_status(:created)
      body = response.parsed_body["domain_file"]
      expect(body["name"]).to eq("새 사전")
      expect(body["content"]).to include("CTQ")
      expect(body["project_id"]).to be_nil
    end

    it "소속 프로젝트 파일 생성" do
      login_as(creator)
      post "/api/v1/domain_files", params: { name: "프로젝트 전용", content: "x", project_id: project.id }
      expect(response).to have_http_status(:created)
      expect(response.parsed_body["domain_file"]["project_id"]).to eq(project.id)
    end

    it "비멤버가 프로젝트 지정 생성 시 403" do
      login_as(other)
      post "/api/v1/domain_files", params: { name: "침입", content: "x", project_id: project.id }
      expect(response).to have_http_status(:forbidden)
      expect(DomainFile.exists?(name: "침입")).to be false
    end

    it "name 누락은 422" do
      login_as(creator)
      post "/api/v1/domain_files", params: { content: "x" }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "같은 스코프 내 이름 중복은 422" do
      create(:domain_file, name: "중복이름", creator: creator, project_id: nil)
      login_as(creator)
      post "/api/v1/domain_files", params: { name: "중복이름", content: "x" }
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "POST /api/v1/domain_files (multipart)" do
    def upload_io(content, filename, content_type)
      Rack::Test::UploadedFile.new(StringIO.new(content), content_type, true, original_filename: filename)
    end

    it ".md 업로드 성공, name 은 파일명에서 확장자 제거" do
      login_as(creator)
      file = upload_io("- **PLC**: Programmable Logic Controller", "설비용어.md", "text/markdown")
      post "/api/v1/domain_files", params: { file: file }
      expect(response).to have_http_status(:created)
      body = response.parsed_body["domain_file"]
      expect(body["name"]).to eq("설비용어")
      expect(body["content"]).to include("PLC")
    end

    it "빈 content_type 이면 확장자로 폴백(.txt)" do
      login_as(creator)
      file = upload_io("자유 텍스트", "메모.txt", "")
      post "/api/v1/domain_files", params: { file: file }
      expect(response).to have_http_status(:created)
    end

    it "허용되지 않는 확장자는 422" do
      login_as(creator)
      file = upload_io("binary-ish", "sheet.csv", "text/csv")
      post "/api/v1/domain_files", params: { file: file }
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "1MB 초과는 422" do
      login_as(creator)
      big = "a" * (1.megabyte + 1)
      file = upload_io(big, "big.txt", "text/plain")
      post "/api/v1/domain_files", params: { file: file }
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "비멤버가 프로젝트 지정 업로드 시 403" do
      login_as(other)
      file = upload_io("x", "a.txt", "text/plain")
      post "/api/v1/domain_files", params: { file: file, project_id: project.id }
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/v1/domain_files/:id" do
    let!(:project_file) { create(:domain_file, :with_project, project: project, name: "프로젝트 사전", creator: creator, content: "본문") }

    it "접근 가능한 사용자는 content 포함 조회" do
      login_as(creator)
      get "/api/v1/domain_files/#{project_file.id}"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["domain_file"]["content"]).to eq("본문")
    end

    it "비접근 사용자는 403" do
      login_as(other)
      get "/api/v1/domain_files/#{project_file.id}"
      expect(response).to have_http_status(:forbidden)
    end

    it "없는 id는 404" do
      login_as(creator)
      get "/api/v1/domain_files/999999"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "PATCH /api/v1/domain_files/:id" do
    let!(:file) { create(:domain_file, name: "원본", creator: creator, content: "원본 내용") }

    it "작성자는 수정 가능" do
      login_as(creator)
      patch "/api/v1/domain_files/#{file.id}", params: { name: "수정됨", content: "새 내용" }
      expect(response).to have_http_status(:ok)
      expect(file.reload.name).to eq("수정됨")
      expect(file.reload.content).to eq("새 내용")
    end

    it "작성자가 아니면 403" do
      login_as(other)
      patch "/api/v1/domain_files/#{file.id}", params: { name: "침입" }
      expect(response).to have_http_status(:forbidden)
      expect(file.reload.name).to eq("원본")
    end

    it "admin은 수정 가능" do
      admin = create(:user, :admin)
      login_as(admin)
      patch "/api/v1/domain_files/#{file.id}", params: { name: "admin수정" }
      expect(response).to have_http_status(:ok)
    end
  end

  describe "DELETE /api/v1/domain_files/:id" do
    let!(:file) { create(:domain_file, creator: creator) }

    it "작성자는 삭제 가능" do
      login_as(creator)
      delete "/api/v1/domain_files/#{file.id}"
      expect(response).to have_http_status(:no_content)
      expect(DomainFile.exists?(file.id)).to be false
    end

    it "작성자가 아니면 403" do
      login_as(other)
      delete "/api/v1/domain_files/#{file.id}"
      expect(response).to have_http_status(:forbidden)
      expect(DomainFile.exists?(file.id)).to be true
    end
  end

  describe "POST /api/v1/domain_files/:id/merge_terms" do
    let!(:file) { create(:domain_file, creator: creator, content: "- **CTQ** [약어]: Critical To Quality") }

    it "신규 용어는 추가, 기존 key는 교체" do
      login_as(creator)
      post "/api/v1/domain_files/#{file.id}/merge_terms", params: {
        terms: [
          { term: "CTQ", category: "약어", definition: "수정된 설명" },
          { term: "OEE", category: "지표", definition: "설비종합효율" }
        ]
      }
      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["added"]).to eq(1)
      expect(body["replaced"]).to eq(1)
      expect(body["domain_file"]["content"]).to include("수정된 설명")
      expect(body["domain_file"]["content"]).to include("OEE")
    end

    it "빈 배열은 422" do
      login_as(creator)
      post "/api/v1/domain_files/#{file.id}/merge_terms", params: { terms: [] }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to be_present
    end

    it "term 전부 blank면 422" do
      login_as(creator)
      post "/api/v1/domain_files/#{file.id}/merge_terms", params: { terms: [{ term: "", category: "a", definition: "b" }] }
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "작성자가 아니면 403" do
      login_as(other)
      post "/api/v1/domain_files/#{file.id}/merge_terms", params: { terms: [{ term: "X", category: "", definition: "y" }] }
      expect(response).to have_http_status(:forbidden)
    end
  end
end
