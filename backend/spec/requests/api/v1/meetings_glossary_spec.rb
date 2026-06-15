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
end
