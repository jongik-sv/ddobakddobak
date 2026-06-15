require "rails_helper"

RSpec.describe "Api::V1 meeting glossary", type: :request do
  let(:user)    { create(:user) }
  let(:folder)  { create(:folder) }
  let!(:meeting) { create(:meeting, creator: user, folder_id: folder.id, status: "completed") }

  before do
    login_as(user)
    create(:transcript, meeting: meeting, content: "회진 결과")
  end

  describe "POST /feedback — 적용 후 회의 사전에 영속" do
    it "교정이 트랜스크립트에 적용되고 회의 사전에 저장된다" do
      post "/api/v1/meetings/#{meeting.id}/feedback",
           params: { corrections: [{ from: "회진", to: "회의" }] }
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
      entry = meeting.glossary_entries.find_by(from_text: "회진")
      expect(entry).to be_present
      expect(entry.to_text).to eq("회의")
    end

    it "같은 from 재교정 시 to_text upsert" do
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [{ from: "회진", to: "회의" }] }
      post "/api/v1/meetings/#{meeting.id}/feedback", params: { corrections: [{ from: "회진", to: "회담" }] }
      expect(meeting.glossary_entries.where(from_text: "회진").count).to eq(1)
      expect(meeting.glossary_entries.find_by(from_text: "회진").to_text).to eq("회담")
    end
  end

  describe "GET /glossary — 3단 뷰" do
    it "ancestors/folder/meeting 엔트리 + resolved 반환" do
      parent = create(:folder)
      folder.update!(parent_id: parent.id)
      parent.glossary_entries.create!(from_text: "AA", to_text: "aa")
      folder.glossary_entries.create!(from_text: "BB", to_text: "bb")
      meeting.glossary_entries.create!(from_text: "CC", to_text: "cc")

      get "/api/v1/meetings/#{meeting.id}/glossary"
      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["meeting"]["entries"].map { |e| e["from_text"] }).to include("CC")
      expect(body["folder"]["entries"].map { |e| e["from_text"] }).to include("BB")
      expect(body["ancestors"].first["entries"].map { |e| e["from_text"] }).to include("AA")
      expect(body["resolved"].map { |e| e["from"] }).to include("AA", "BB", "CC")
    end
  end

  describe "POST /reapply_glossary — 전 표면 수동 재적용" do
    it "resolver 교정을 전 표면에 적용" do
      folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 노트")

      post "/api/v1/meetings/#{meeting.id}/reapply_glossary"
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 노트")
    end
  end

  describe "POST /apply_glossary_entry — 항목별 개별 적용" do
    it "지정한 회의 엔트리 한 건만 전 표면에 적용한다" do
      e1 = meeting.glossary_entries.create!(from_text: "회진", to_text: "회의")
      meeting.glossary_entries.create!(from_text: "결과", to_text: "리포트") # 적용 안 됨
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "회진 결과 노트")

      post "/api/v1/meetings/#{meeting.id}/apply_glossary_entry", params: { entry_id: e1.id }
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과") # 회진만 치환, 결과 보존
      expect(meeting.summaries.first.reload.notes_markdown).to eq("회의 결과 노트")
    end

    it "폴더(상위) 엔트리도 이 회의에 적용 가능" do
      fe = folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
      post "/api/v1/meetings/#{meeting.id}/apply_glossary_entry", params: { entry_id: fe.id }
      expect(response).to have_http_status(:ok)
      expect(meeting.transcripts.first.reload.content).to eq("회의 결과")
    end

    it "이 회의 캐스케이드에 속하지 않는 엔트리는 404" do
      other_folder = create(:folder)
      stray = other_folder.glossary_entries.create!(from_text: "회진", to_text: "회의")
      post "/api/v1/meetings/#{meeting.id}/apply_glossary_entry", params: { entry_id: stray.id }
      expect(response).to have_http_status(:not_found)
      expect(meeting.transcripts.first.reload.content).to eq("회진 결과") # 미적용
    end

    it "disabled 엔트리는 422" do
      e = meeting.glossary_entries.create!(from_text: "회진", to_text: "회의", enabled: false)
      post "/api/v1/meetings/#{meeting.id}/apply_glossary_entry", params: { entry_id: e.id }
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "제어 권한 없는 사용자는 403" do
      stranger = create(:user)
      login_as(stranger)
      e = meeting.glossary_entries.create!(from_text: "회진", to_text: "회의")
      post "/api/v1/meetings/#{meeting.id}/apply_glossary_entry", params: { entry_id: e.id }
      expect(response).to have_http_status(:forbidden)
    end
  end
end
