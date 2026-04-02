require "rails_helper"

RSpec.describe "Api::V1::MeetingShares", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  # ============================================================
  # POST /api/v1/meetings/:id/share
  # ============================================================
  describe "POST /api/v1/meetings/:id/share" do
    context "when user is the meeting creator" do
      it "returns a share code" do
        post "/api/v1/meetings/#{meeting.id}/share"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["share_code"]).to match(/\A[A-Z0-9]{6}\z/)
      end

      it "returns participants list" do
        post "/api/v1/meetings/#{meeting.id}/share"

        json = response.parsed_body
        expect(json["participants"]).to be_an(Array)
        expect(json["participants"].first["role"]).to eq("host")
      end

      it "is idempotent - returns same code on repeated call" do
        post "/api/v1/meetings/#{meeting.id}/share"
        first_code = response.parsed_body["share_code"]

        post "/api/v1/meetings/#{meeting.id}/share"
        second_code = response.parsed_body["share_code"]

        expect(second_code).to eq(first_code)
      end
    end

    context "when user is not the meeting creator" do
      before { login_as(other_user) }

      it "returns forbidden" do
        post "/api/v1/meetings/#{meeting.id}/share"

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # ============================================================
  # DELETE /api/v1/meetings/:id/share
  # ============================================================
  describe "DELETE /api/v1/meetings/:id/share" do
    before do
      # Create share as the meeting creator
      login_as(user)
      post "/api/v1/meetings/#{meeting.id}/share"
    end

    context "when user is the host" do
      it "returns no content" do
        delete "/api/v1/meetings/#{meeting.id}/share"

        expect(response).to have_http_status(:no_content)
      end

      it "clears the share code" do
        delete "/api/v1/meetings/#{meeting.id}/share"

        expect(meeting.reload.share_code).to be_nil
      end
    end

    context "when user is not the host" do
      before { login_as(other_user) }

      it "returns forbidden" do
        delete "/api/v1/meetings/#{meeting.id}/share"

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/join
  # ============================================================
  describe "POST /api/v1/meetings/join" do
    before do
      post "/api/v1/meetings/#{meeting.id}/share"
      @share_code = response.parsed_body["share_code"]
    end

    context "with valid share code" do
      before { login_as(other_user) }

      it "returns meeting and participant info" do
        post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["id"]).to eq(meeting.id)
        expect(json["participant"]["role"]).to eq("viewer")
      end

      it "is idempotent for same user" do
        post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json
        first_id = response.parsed_body["participant"]["id"]

        post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json
        second_id = response.parsed_body["participant"]["id"]

        expect(second_id).to eq(first_id)
      end
    end

    context "with invalid share code" do
      before { login_as(other_user) }

      it "returns not found" do
        post "/api/v1/meetings/join", params: { share_code: "XXXXXX" }, as: :json

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when participant limit reached" do
      before { login_as(other_user) }

      it "returns unprocessable entity" do
        # Fill up to 20 participants (1 host + 19 viewers)
        19.times do
          u = create(:user)
          login_as(u)
          post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json
        end

        login_as(other_user)
        post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  # ============================================================
  # GET /api/v1/meetings/:id/participants
  # ============================================================
  describe "GET /api/v1/meetings/:id/participants" do
    before do
      post "/api/v1/meetings/#{meeting.id}/share"
      @share_code = response.parsed_body["share_code"]

      login_as(other_user)
      post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json
      login_as(user)
    end

    context "when user is a participant" do
      it "returns participants list" do
        get "/api/v1/meetings/#{meeting.id}/participants"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["participants"].length).to eq(2)
      end

      it "includes user info and role" do
        get "/api/v1/meetings/#{meeting.id}/participants"

        json = response.parsed_body
        host = json["participants"].find { |p| p["role"] == "host" }
        expect(host["user_id"]).to eq(user.id)
        expect(host["user_name"]).to be_present
      end
    end

    context "when user is not a participant" do
      let(:outsider) { create(:user) }

      before { login_as(outsider) }

      it "returns forbidden" do
        get "/api/v1/meetings/#{meeting.id}/participants"

        expect(response).to have_http_status(:forbidden)
      end
    end
  end

  # ============================================================
  # POST /api/v1/meetings/:id/transfer_host
  # ============================================================
  describe "POST /api/v1/meetings/:id/transfer_host" do
    before do
      post "/api/v1/meetings/#{meeting.id}/share"
      @share_code = response.parsed_body["share_code"]

      login_as(other_user)
      post "/api/v1/meetings/join", params: { share_code: @share_code }, as: :json
      login_as(user)
    end

    context "when user is the current host" do
      it "transfers host to target user" do
        post "/api/v1/meetings/#{meeting.id}/transfer_host",
             params: { target_user_id: other_user.id }, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        new_host = json["participants"].find { |p| p["role"] == "host" }
        expect(new_host["user_id"]).to eq(other_user.id)
      end
    end

    context "when user is not the host" do
      before { login_as(other_user) }

      it "returns forbidden" do
        post "/api/v1/meetings/#{meeting.id}/transfer_host",
             params: { target_user_id: user.id }, as: :json

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when target is not an active participant" do
      let(:non_participant) { create(:user) }

      it "returns unprocessable entity" do
        post "/api/v1/meetings/#{meeting.id}/transfer_host",
             params: { target_user_id: non_participant.id }, as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end
end
