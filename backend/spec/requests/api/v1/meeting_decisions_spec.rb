require "rails_helper"

RSpec.describe "Api::V1::MeetingDecisions", type: :request do
  let(:user)       { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  describe "GET /api/v1/meetings/:meeting_id/decisions" do
    context "인증된 팀 멤버" do
      it "200과 decisions 배열 반환" do
        decision = create(:decision, meeting: meeting, content: "API 설계 확정")
        get "/api/v1/meetings/#{meeting.id}/decisions"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json).to be_an(Array)
        expect(json.length).to eq(1)
        expect(json.first["content"]).to eq("API 설계 확정")
        expect(json.first).to have_key("id")
        expect(json.first).to have_key("status")
        expect(json.first).to have_key("ai_generated")
        expect(json.first).to have_key("context")
        expect(json.first).to have_key("participants")
      end

      it "빈 배열 반환 (decisions 없을 때)" do
        get "/api/v1/meetings/#{meeting.id}/decisions"

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq([])
      end
    end
  end

  describe "POST /api/v1/meetings/:meeting_id/decisions" do
    context "인증된 팀 멤버" do
      it "201과 생성된 decision 반환" do
        expect {
          post "/api/v1/meetings/#{meeting.id}/decisions",
               params: { decision: { content: "새 결정사항" } },
               as: :json
        }.to change(Decision, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["content"]).to eq("새 결정사항")
        expect(json["ai_generated"]).to eq(false)
        expect(json["status"]).to eq("active")
      end

      it "context, participants 포함해서 생성" do
        post "/api/v1/meetings/#{meeting.id}/decisions",
             params: { decision: { content: "배포 일정 확정", context: "QA 완료 후", participants: "김개발, 박매니저" } },
             as: :json

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["context"]).to eq("QA 완료 후")
        expect(json["participants"]).to eq("김개발, 박매니저")
      end

      it "422 반환 (content 없음)" do
        post "/api/v1/meetings/#{meeting.id}/decisions",
             params: { decision: { content: "" } },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["errors"]).to be_present
      end
    end
  end
end
