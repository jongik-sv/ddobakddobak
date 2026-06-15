require "rails_helper"

RSpec.describe "Api::V1::GlossaryEntries", type: :request do
  let(:owner)  { create(:user) }
  let(:other)  { create(:user) }
  let(:folder) { create(:folder) }
  let!(:meeting) { create(:meeting, creator: owner, folder_id: folder.id) }

  describe "POST /folders/:id/glossary_entries" do
    it "직속 회의 creator 는 폴더 엔트리 생성 가능" do
      login_as(owner)
      post "/api/v1/folders/#{folder.id}/glossary_entries",
           params: { from_text: "회진", to_text: "회의" }
      expect(response).to have_http_status(:created)
      expect(folder.glossary_entries.count).to eq(1)
    end

    it "무관한 사용자는 폴더 엔트리 생성 불가 (403)" do
      login_as(other)
      post "/api/v1/folders/#{folder.id}/glossary_entries",
           params: { from_text: "회진", to_text: "회의" }
      expect(response).to have_http_status(:forbidden)
      expect(folder.glossary_entries.count).to eq(0)
    end
  end

  describe "POST /meetings/:id/glossary_entries" do
    it "회의 소유자는 회의 엔트리 생성 가능" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/glossary_entries",
           params: { from_text: "x", to_text: "y", match_type: "regex" }
      expect(response).to have_http_status(:created)
      expect(meeting.glossary_entries.first.match_type).to eq("regex")
    end

    it "잘못된 정규식은 422" do
      login_as(owner)
      post "/api/v1/meetings/#{meeting.id}/glossary_entries",
           params: { from_text: "(open", to_text: "y", match_type: "regex" }
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "PATCH/DELETE /glossary_entries/:id" do
    let!(:entry) { folder.glossary_entries.create!(from_text: "a", to_text: "b") }

    it "권한자는 수정" do
      login_as(owner)
      patch "/api/v1/glossary_entries/#{entry.id}", params: { to_text: "c" }
      expect(response).to have_http_status(:ok)
      expect(entry.reload.to_text).to eq("c")
    end

    it "무권한자는 수정 불가 (403)" do
      login_as(other)
      patch "/api/v1/glossary_entries/#{entry.id}", params: { to_text: "c" }
      expect(response).to have_http_status(:forbidden)
    end

    it "권한자는 삭제" do
      login_as(owner)
      delete "/api/v1/glossary_entries/#{entry.id}"
      expect(response).to have_http_status(:no_content)
      expect(GlossaryEntry.exists?(entry.id)).to be false
    end
  end

  describe "GET /folders/:id/glossary_entries" do
    before do
      folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
      folder.glossary_entries.create!(from_text: "결과", to_text: "리포트")
    end

    it "폴더 편집자는 폴더 엔트리 목록을 조회한다" do
      login_as(owner)
      get "/api/v1/folders/#{folder.id}/glossary_entries"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["entries"].map { |e| e["from_text"] }).to contain_exactly("회진", "결과")
    end

    it "무관한 사용자는 403" do
      login_as(other)
      get "/api/v1/folders/#{folder.id}/glossary_entries"
      expect(response).to have_http_status(:forbidden)
    end

    it "없는 폴더는 404" do
      login_as(owner)
      get "/api/v1/folders/999999/glossary_entries"
      expect(response).to have_http_status(:not_found)
    end
  end
end
