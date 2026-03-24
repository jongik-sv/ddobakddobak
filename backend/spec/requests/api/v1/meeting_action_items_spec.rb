require "rails_helper"

RSpec.describe "Api::V1::MeetingActionItems", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }

  def auth_headers(u = user)
    post "/api/v1/login", params: { email: u.email, password: "password123" }, as: :json
    token = response.parsed_body["token"]
    { "Authorization" => "Bearer #{token}" }
  end

  describe "GET /api/v1/meetings/:meeting_id/action_items" do
    context "인증된 팀 멤버" do
      it "200과 action_items 배열 반환" do
        item = create(:action_item, meeting: meeting, content: "할 일 1")
        get "/api/v1/meetings/#{meeting.id}/action_items", headers: auth_headers

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json).to be_an(Array)
        expect(json.length).to eq(1)
        expect(json.first["content"]).to eq("할 일 1")
        expect(json.first).to have_key("id")
        expect(json.first).to have_key("status")
        expect(json.first).to have_key("ai_generated")
        expect(json.first).to have_key("assignee")
      end

      it "빈 배열 반환 (action_items 없을 때)" do
        get "/api/v1/meetings/#{meeting.id}/action_items", headers: auth_headers

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq([])
      end
    end

    context "미인증" do
      it "401 반환" do
        get "/api/v1/meetings/#{meeting.id}/action_items"
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "다른 팀 회의" do
      let(:other_team)    { create(:team, creator: other_user) }
      let!(:other_membership) { create(:team_membership, user: other_user, team: other_team, role: "admin") }
      let(:other_meeting) { create(:meeting, team: other_team, creator: other_user) }

      it "403 반환" do
        get "/api/v1/meetings/#{other_meeting.id}/action_items", headers: auth_headers

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  describe "POST /api/v1/meetings/:meeting_id/action_items" do
    context "인증된 팀 멤버" do
      it "201과 생성된 action_item 반환" do
        expect {
          post "/api/v1/meetings/#{meeting.id}/action_items",
               params: { action_item: { content: "새 할 일" } },
               headers: auth_headers, as: :json
        }.to change(ActionItem, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["content"]).to eq("새 할 일")
        expect(json["ai_generated"]).to eq(false)
        expect(json["status"]).to eq("todo")
      end

      it "assignee_id, due_date 포함해서 생성" do
        assignee = create(:user)
        create(:team_membership, user: assignee, team: team, role: "member")

        post "/api/v1/meetings/#{meeting.id}/action_items",
             params: { action_item: { content: "담당자 할 일", assignee_id: assignee.id, due_date: "2026-04-01" } },
             headers: auth_headers, as: :json

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["assignee"]["id"]).to eq(assignee.id)
        expect(json["due_date"]).to eq("2026-04-01")
      end

      it "422 반환 (content 없음)" do
        post "/api/v1/meetings/#{meeting.id}/action_items",
             params: { action_item: { content: "" } },
             headers: auth_headers, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["errors"]).to be_present
      end
    end

    context "다른 팀 회의" do
      let(:other_team)    { create(:team, creator: other_user) }
      let!(:other_membership) { create(:team_membership, user: other_user, team: other_team, role: "admin") }
      let(:other_meeting) { create(:meeting, team: other_team, creator: other_user) }

      it "403 반환" do
        post "/api/v1/meetings/#{other_meeting.id}/action_items",
             params: { action_item: { content: "침입 시도" } },
             headers: auth_headers, as: :json

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "미인증" do
      it "401 반환" do
        post "/api/v1/meetings/#{meeting.id}/action_items",
             params: { action_item: { content: "새 할 일" } }, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end
