require "rails_helper"

RSpec.describe "Api::V1::ActionItems", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }
  let(:action_item) { create(:action_item, meeting: meeting, content: "기존 할 일", status: "todo") }

  def auth_headers(u = user)
    post "/api/v1/login", params: { email: u.email, password: "password123" }, as: :json
    token = response.parsed_body["token"]
    { "Authorization" => "Bearer #{token}" }
  end

  describe "PATCH /api/v1/action_items/:id" do
    context "인증된 팀 멤버" do
      it "200과 status 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { status: "done" } },
              headers: auth_headers, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["status"]).to eq("done")
        expect(json["id"]).to eq(action_item.id)
      end

      it "200과 assignee_id 업데이트 반환" do
        assignee = create(:user)
        create(:team_membership, user: assignee, team: team, role: "member")

        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { assignee_id: assignee.id } },
              headers: auth_headers, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["assignee"]["id"]).to eq(assignee.id)
      end

      it "200과 due_date 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { due_date: "2026-05-01" } },
              headers: auth_headers, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["due_date"]).to eq("2026-05-01")
      end

      it "200과 content 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { content: "수정된 할 일" } },
              headers: auth_headers, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["content"]).to eq("수정된 할 일")
      end
    end

    context "다른 팀 item" do
      let(:other_team)    { create(:team, creator: other_user) }
      let!(:other_membership) { create(:team_membership, user: other_user, team: other_team, role: "admin") }
      let(:other_meeting) { create(:meeting, team: other_team, creator: other_user) }
      let(:other_item)    { create(:action_item, meeting: other_meeting) }

      it "403 반환" do
        patch "/api/v1/action_items/#{other_item.id}",
              params: { action_item: { status: "done" } },
              headers: auth_headers, as: :json

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "미인증" do
      it "401 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { status: "done" } }, as: :json

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "DELETE /api/v1/action_items/:id" do
    context "인증된 팀 멤버" do
      it "204와 DB에서 제거" do
        item_to_delete = create(:action_item, meeting: meeting)

        expect {
          delete "/api/v1/action_items/#{item_to_delete.id}", headers: auth_headers
        }.to change(ActionItem, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end
    end

    context "다른 팀 item" do
      let(:other_team)    { create(:team, creator: other_user) }
      let!(:other_membership) { create(:team_membership, user: other_user, team: other_team, role: "admin") }
      let(:other_meeting) { create(:meeting, team: other_team, creator: other_user) }
      let(:other_item)    { create(:action_item, meeting: other_meeting) }

      it "403 반환" do
        delete "/api/v1/action_items/#{other_item.id}", headers: auth_headers

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "미인증" do
      it "401 반환" do
        delete "/api/v1/action_items/#{action_item.id}"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end
