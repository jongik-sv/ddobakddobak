require "rails_helper"

RSpec.describe "GET /api/v1/meetings/:id/export", type: :request do
  let(:user)    { create(:user) }
  let(:team)    { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting) { create(:meeting, team: team, creator: user, status: "completed") }

  before { login_as(user) }

  context "인증된 팀원이 요청할 때" do
    before do
      create(:transcript, meeting: meeting, speaker_label: "화자1",
             content: "테스트 발언", started_at_ms: 0, sequence_number: 1)
      create(:summary, meeting: meeting, summary_type: "final",
             key_points: ["핵심 1"].to_json, decisions: [].to_json,
             discussion_details: [].to_json)
    end

    it "200 OK를 반환한다" do
      get "/api/v1/meetings/#{meeting.id}/export"
      expect(response).to have_http_status(:ok)
    end

    it "Content-Type이 text/markdown이다" do
      get "/api/v1/meetings/#{meeting.id}/export"
      expect(response.content_type).to include("text/markdown")
    end

    it "회의 제목을 포함한다" do
      get "/api/v1/meetings/#{meeting.id}/export"
      expect(response.body).to include(meeting.title)
    end

    it "기본값으로 요약과 원본 텍스트를 모두 포함한다" do
      get "/api/v1/meetings/#{meeting.id}/export"
      expect(response.body).to include("## AI 요약")
      expect(response.body).to include("## 원본 텍스트")
    end
  end

  context "include_summary=false 파라미터" do
    before { create(:summary, meeting: meeting, summary_type: "final") }

    it "AI 요약 섹션을 제외한다" do
      get "/api/v1/meetings/#{meeting.id}/export",
          params: { include_summary: "false" }
      expect(response.body).not_to include("## AI 요약")
    end
  end

  context "include_transcript=false 파라미터" do
    before { create(:transcript, meeting: meeting) }

    it "원본 텍스트 섹션을 제외한다" do
      get "/api/v1/meetings/#{meeting.id}/export",
          params: { include_transcript: "false" }
      expect(response.body).not_to include("## 원본 텍스트")
    end
  end

end
