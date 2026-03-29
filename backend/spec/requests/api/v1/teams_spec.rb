require "rails_helper"

RSpec.describe "Api::V1::Teams", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  before { login_as(user) }

  describe "GET /api/v1/teams" do
    context "when authenticated" do
      it "returns teams the user belongs to" do
        team = create(:team, creator: user)
        create(:team_membership, user: user, team: team, role: "admin")
        other_team = create(:team, creator: other_user)
        create(:team_membership, user: other_user, team: other_team, role: "admin")

        get "/api/v1/teams"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json.length).to eq(1)
        expect(json.first["name"]).to eq(team.name)
        expect(json.first["role"]).to eq("admin")
        expect(json.first["member_count"]).to eq(1)
      end

      it "returns empty array when no teams" do
        get "/api/v1/teams"

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body).to eq([])
      end
    end

  end

  describe "POST /api/v1/teams" do
    context "when authenticated" do
      it "creates a team and adds creator as admin" do
        expect {
          post "/api/v1/teams", params: { name: "Dev Team" }, as: :json
        }.to change(Team, :count).by(1).and change(TeamMembership, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["team"]["name"]).to eq("Dev Team")
        expect(json["team"]["role"]).to eq("admin")
        expect(json["team"]["member_count"]).to eq(1)

        membership = TeamMembership.last
        expect(membership.user).to eq(user)
        expect(membership.role).to eq("admin")
      end

      it "returns 422 when name is blank" do
        post "/api/v1/teams", params: { name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

  end

  describe "POST /api/v1/teams/:id/invite" do
    let!(:team) { create(:team, creator: user) }
    let!(:admin_membership) { create(:team_membership, user: user, team: team, role: "admin") }

    context "as admin" do
      it "adds the user to the team as member" do
        expect {
          post "/api/v1/teams/#{team.id}/invite",
               params: { email: other_user.email },
               as: :json
        }.to change(TeamMembership, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["membership"]["role"]).to eq("member")

        membership = TeamMembership.find_by(user: other_user, team: team)
        expect(membership).to be_present
        expect(membership.role).to eq("member")
      end

      it "returns 404 when email not found" do
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: "nobody@example.com" },
             as: :json
        expect(response).to have_http_status(:not_found)
      end

      it "returns 422 when user already in team" do
        create(:team_membership, user: other_user, team: team, role: "member")
        post "/api/v1/teams/#{team.id}/invite",
             params: { email: other_user.email },
             as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

  end

  describe "DELETE /api/v1/teams/:id/members/:user_id" do
    let!(:team) { create(:team, creator: user) }
    let!(:admin_membership) { create(:team_membership, user: user, team: team, role: "admin") }
    let!(:member_membership) { create(:team_membership, user: other_user, team: team, role: "member") }

    context "as admin" do
      it "removes the member from the team" do
        expect {
          delete "/api/v1/teams/#{team.id}/members/#{other_user.id}"
        }.to change(TeamMembership, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end

      it "returns 404 when member not found" do
        delete "/api/v1/teams/#{team.id}/members/999"
        expect(response).to have_http_status(:not_found)
      end
    end

  end
end
