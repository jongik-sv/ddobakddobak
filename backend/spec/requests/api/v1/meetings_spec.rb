require "rails_helper"

RSpec.describe "Api::V1::Meetings", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let!(:admin_membership) { create(:team_membership, user: user, team: team, role: "admin") }
  let(:meeting) { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  # ============================================================
  # GET /api/v1/meetings
  # ============================================================
  describe "GET /api/v1/meetings" do
    context "when authenticated" do
      it "returns meetings belonging to user's teams" do
        meeting = create(:meeting, team: team, creator: user)
        other_team = create(:team, creator: other_user)
        create(:team_membership, user: other_user, team: other_team, role: "admin")
        _other_meeting = create(:meeting, team: other_team, creator: other_user)

        get "/api/v1/meetings"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meetings"].first["id"]).to eq(meeting.id)
      end

      it "returns pagination meta" do
        get "/api/v1/meetings"

        json = response.parsed_body
        expect(json["meta"]).to include("total", "page", "per")
      end

      it "supports page and per params" do
        create_list(:meeting, 3, team: team, creator: user)

        get "/api/v1/meetings", params: { page: 1, per: 2 }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(2)
        expect(json["meta"]["total"]).to eq(3)
        expect(json["meta"]["page"]).to eq(1)
        expect(json["meta"]["per"]).to eq(2)
      end

      it "supports search by title with q param" do
        create(:meeting, team: team, creator: user, title: "Design Review")
        create(:meeting, team: team, creator: user, title: "Sprint Planning")

        get "/api/v1/meetings", params: { q: "design" }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meetings"].first["title"]).to eq("Design Review")
      end

      it "returns empty meetings when no meetings" do
        get "/api/v1/meetings"

        json = response.parsed_body
        expect(json["meetings"]).to eq([])
        expect(json["meta"]["total"]).to eq(0)
      end
    end

  end

  # ============================================================
  # POST /api/v1/meetings
  # ============================================================
  describe "POST /api/v1/meetings" do
    context "when authenticated as team member" do
      it "creates a meeting" do
        expect {
          post "/api/v1/meetings",
               params: { title: "New Meeting", team_id: team.id },
               as: :json
        }.to change(Meeting, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["meeting"]["title"]).to eq("New Meeting")
        expect(json["meeting"]["status"]).to eq("pending")
      end

      it "sets created_by_id to current_user" do
        post "/api/v1/meetings",
             params: { title: "My Meeting", team_id: team.id },
             as: :json

        meeting = Meeting.last
        expect(meeting.created_by_id).to eq(user.id)
      end

      it "returns 422 when title is blank" do
        post "/api/v1/meetings",
             params: { title: "", team_id: team.id },
             as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "returns 404 when team not found" do
        post "/api/v1/meetings",
             params: { title: "New Meeting", team_id: 99999 },
             as: :json

        expect(response).to have_http_status(:not_found)
      end
    end

  end

  # ============================================================
  # GET /api/v1/meetings/:id
  # ============================================================
  describe "GET /api/v1/meetings/:id" do
    context "when authenticated as team member" do
      it "returns meeting with transcripts, summary, and action_items" do
        transcript = create(:transcript, meeting: meeting, sequence_number: 1)
        summary = create(:summary, meeting: meeting, summary_type: "final")
        action_item = create(:action_item, meeting: meeting)

        get "/api/v1/meetings/#{meeting.id}"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["id"]).to eq(meeting.id)
        expect(json["meeting"]["transcripts"].length).to eq(1)
        expect(json["meeting"]["transcripts"].first["id"]).to eq(transcript.id)
        expect(json["meeting"]["summary"]).to include("key_points")
        expect(json["meeting"]["action_items"].length).to eq(1)
        expect(json["meeting"]["action_items"].first["id"]).to eq(action_item.id)
      end

      it "returns transcripts ordered by sequence_number" do
        create(:transcript, meeting: meeting, sequence_number: 3, content: "Third")
        create(:transcript, meeting: meeting, sequence_number: 1, content: "First")
        create(:transcript, meeting: meeting, sequence_number: 2, content: "Second")

        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        contents = json["meeting"]["transcripts"].map { |t| t["content"] }
        expect(contents).to eq(%w[First Second Third])
      end

      it "prefers final summary over realtime" do
        create(:summary, meeting: meeting, summary_type: "realtime")
        final_summary = create(:summary, meeting: meeting, summary_type: "final")

        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        expect(json["meeting"]["summary"]["id"]).to eq(final_summary.id)
      end

      it "returns null summary when none exists" do
        get "/api/v1/meetings/#{meeting.id}"

        json = response.parsed_body
        expect(json["meeting"]["summary"]).to be_nil
      end

      it "returns 404 when meeting not found" do
        get "/api/v1/meetings/99999"
        expect(response).to have_http_status(:not_found)
      end

      it "200 OK 및 회의 데이터 반환" do
        get "/api/v1/meetings/#{meeting.id}"
        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["id"]).to eq(meeting.id)
        expect(json["meeting"]["title"]).to eq(meeting.title)
        expect(json["meeting"]["status"]).to eq(meeting.status)
        expect(json["meeting"]["created_by_id"]).to eq(meeting.created_by_id)
      end

      it "응답에 필요한 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}"
        json = response.parsed_body
        expect(json["meeting"].keys).to include(
          "id", "title", "status",
          "started_at", "ended_at",
          "created_by_id",
          "created_at", "updated_at"
        )
      end
    end

    context "존재하지 않는 회의 ID" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/99999"
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body["error"]).to eq("Meeting not found")
      end
    end
  end

  # ============================================================
  # PATCH /api/v1/meetings/:id
  # ============================================================
  describe "PATCH /api/v1/meetings/:id" do
    let(:meeting) { create(:meeting, team: team, creator: user, title: "Old Title") }

    context "as meeting creator" do
      it "updates the meeting title" do
        patch "/api/v1/meetings/#{meeting.id}",
              params: { title: "New Title" },
              as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["title"]).to eq("New Title")
        expect(meeting.reload.title).to eq("New Title")
      end

      it "returns 422 when title is blank" do
        patch "/api/v1/meetings/#{meeting.id}",
              params: { title: "" },
              as: :json

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

  end

  # ============================================================
  # DELETE /api/v1/meetings/:id
  # ============================================================
  describe "DELETE /api/v1/meetings/:id" do
    let!(:meeting) { create(:meeting, team: team, creator: user) }

    context "as meeting creator" do
      it "deletes the meeting" do
        expect {
          delete "/api/v1/meetings/#{meeting.id}"
        }.to change(Meeting, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end
    end

  end

  # ============================================================
  # POST /api/v1/meetings/:id/start
  # ============================================================
  describe "POST /api/v1/meetings/:id/start" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "pending") }

    context "when meeting is pending" do
      it "transitions to recording and sets started_at" do
        post "/api/v1/meetings/#{meeting.id}/start"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["status"]).to eq("recording")
        expect(meeting.reload.status).to eq("recording")
        expect(meeting.reload.started_at).not_to be_nil
      end
    end

    context "when meeting is not pending" do
      let(:recording_meeting) { create(:meeting, team: team, creator: user, status: "recording") }

      it "returns 422" do
        post "/api/v1/meetings/#{recording_meeting.id}/start"
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

  end

  # ============================================================
  # POST /api/v1/meetings/:id/stop
  # ============================================================
  describe "POST /api/v1/meetings/:id/stop" do
    let(:meeting) { create(:meeting, team: team, creator: user, status: "recording") }

    context "when meeting is recording" do
      it "transitions to completed and sets ended_at" do
        allow_any_instance_of(MeetingFinalizerService).to receive(:call)

        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["status"]).to eq("completed")
        expect(meeting.reload.status).to eq("completed")
        expect(meeting.reload.ended_at).not_to be_nil
      end

      it "calls MeetingFinalizerService" do
        finalizer = instance_double(MeetingFinalizerService)
        allow(MeetingFinalizerService).to receive(:new).with(meeting).and_return(finalizer)
        allow(finalizer).to receive(:call)

        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(finalizer).to have_received(:call)
      end
    end

    context "when meeting is not recording" do
      let(:pending_meeting) { create(:meeting, team: team, creator: user, status: "pending") }

      it "returns 422" do
        post "/api/v1/meetings/#{pending_meeting.id}/stop"
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

  end

  # ============================================================
  # GET /api/v1/meetings/:id/audio
  # ============================================================
  describe "GET /api/v1/meetings/:id/audio" do
    let(:meeting) { create(:meeting, team: team, creator: user) }

    context "when audio file exists" do
      let(:audio_path) { Rails.root.join("tmp", "test_audio.webm").to_s }

      before do
        File.write(audio_path, "fake audio content")
        meeting.update!(audio_file_path: audio_path)
      end

      after do
        File.delete(audio_path) if File.exist?(audio_path)
      end

      it "streams the audio file" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:ok)
      end
    end

    context "when audio file does not exist" do
      it "returns 404" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:not_found)
      end
    end

  end
end
