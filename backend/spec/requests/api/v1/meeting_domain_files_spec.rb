require "rails_helper"

RSpec.describe "Api::V1 meeting domain files", type: :request do
  let(:owner) { create(:user) }
  let(:other) { create(:user) }
  let(:project) { create(:project, creator: owner) }
  let!(:meeting) { create(:meeting, creator: owner, project: project) }
  let!(:file_a) { create(:domain_file, name: "A사전", creator: owner) }
  let!(:file_b) { create(:domain_file, name: "B사전", creator: owner) }

  describe "GET /api/v1/meetings/:id/domain_files" do
    before { create(:meeting_domain_file, meeting: meeting, domain_file: file_b) }

    it "선택된 파일 목록을 id순으로 반환" do
      login_as(owner)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["domain_files"].map { |f| f["id"] }).to eq([ file_b.id ])
    end

    it "회의 열람 권한이 없으면 403" do
      login_as(other)
      get "/api/v1/meetings/#{meeting.id}/domain_files"
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PUT /api/v1/meetings/:id/domain_files" do
    it "선택을 전체 교체한다" do
      create(:meeting_domain_file, meeting: meeting, domain_file: file_a)
      login_as(owner)
      put "/api/v1/meetings/#{meeting.id}/domain_files", params: { domain_file_ids: [ file_b.id ] }
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.domain_files.pluck(:id)).to eq([ file_b.id ])
    end

    it "빈 배열은 전체 해제" do
      create(:meeting_domain_file, meeting: meeting, domain_file: file_a)
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
