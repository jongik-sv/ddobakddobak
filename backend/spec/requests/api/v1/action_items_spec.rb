require "rails_helper"

RSpec.describe "Api::V1::ActionItems", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:project)       { create(:project, creator: user) }
  let!(:membership) { create(:project_membership, user: user, project: project, role: "member") }
  let(:meeting)    { create(:meeting, project: project, creator: user) }
  let(:action_item) { create(:action_item, meeting: meeting, content: "기존 할 일", status: "todo") }

  before { login_as(user) }

  describe "PATCH /api/v1/action_items/:id" do
    context "인증된 프로젝트 멤버" do
      it "200과 status 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { status: "done" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["status"]).to eq("done")
        expect(json["id"]).to eq(action_item.id)
      end

      it "200과 assignee_id 업데이트 반환" do
        assignee = create(:user)
        create(:project_membership, user: assignee, project: project, role: "member")

        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { assignee_id: assignee.id } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["assignee"]["id"]).to eq(assignee.id)
      end

      it "200과 due_date 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { due_date: "2026-05-01" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["due_date"]).to eq("2026-05-01")
      end

      it "200과 content 업데이트 반환" do
        patch "/api/v1/action_items/#{action_item.id}",
              params: { action_item: { content: "수정된 할 일" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["content"]).to eq("수정된 할 일")
      end
    end
  end

  describe "DELETE /api/v1/action_items/:id" do
    context "인증된 프로젝트 멤버" do
      it "204와 DB에서 제거" do
        item_to_delete = create(:action_item, meeting: meeting)

        expect {
          delete "/api/v1/action_items/#{item_to_delete.id}"
        }.to change(ActionItem, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end
    end
  end
end
