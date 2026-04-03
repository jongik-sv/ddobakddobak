require "rails_helper"

RSpec.describe "Api::V1::Decisions", type: :request do
  let(:user)       { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }
  let(:decision)   { create(:decision, meeting: meeting, content: "기존 결정사항", status: "active") }

  before { login_as(user) }

  describe "GET /api/v1/decisions" do
    it "200과 전체 decisions 타임라인 반환" do
      create(:decision, meeting: meeting, content: "결정 1")
      create(:decision, meeting: meeting, content: "결정 2")
      get "/api/v1/decisions"

      expect(response).to have_http_status(:ok)
      json = response.parsed_body
      expect(json).to be_an(Array)
      expect(json.length).to eq(2)
    end

    it "folder_id 필터 적용" do
      folder = create(:folder, team: team)
      meeting_in_folder = create(:meeting, team: team, creator: user, folder: folder)
      create(:decision, meeting: meeting_in_folder, content: "폴더 내 결정")
      create(:decision, meeting: meeting, content: "폴더 외 결정")

      get "/api/v1/decisions", params: { folder_id: folder.id }

      expect(response).to have_http_status(:ok)
      json = response.parsed_body
      expect(json.length).to eq(1)
      expect(json.first["content"]).to eq("폴더 내 결정")
    end
  end

  describe "PATCH /api/v1/decisions/:id" do
    context "인증된 팀 멤버" do
      it "200과 status 업데이트 반환" do
        patch "/api/v1/decisions/#{decision.id}",
              params: { decision: { status: "revised" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["status"]).to eq("revised")
        expect(json["id"]).to eq(decision.id)
      end

      it "200과 content 업데이트 반환" do
        patch "/api/v1/decisions/#{decision.id}",
              params: { decision: { content: "수정된 결정" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["content"]).to eq("수정된 결정")
      end

      it "200과 context 업데이트 반환" do
        patch "/api/v1/decisions/#{decision.id}",
              params: { decision: { context: "새로운 맥락" } },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["context"]).to eq("새로운 맥락")
      end
    end
  end

  describe "DELETE /api/v1/decisions/:id" do
    context "인증된 팀 멤버" do
      it "204와 DB에서 제거" do
        item_to_delete = create(:decision, meeting: meeting)

        expect {
          delete "/api/v1/decisions/#{item_to_delete.id}"
        }.to change(Decision, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end
    end
  end
end
