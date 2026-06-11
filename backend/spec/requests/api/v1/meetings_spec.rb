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
      it "returns meetings created by the user" do
        meeting = create(:meeting, team: team, creator: user)

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

      it "returns status_counts breakdown for the dashboard" do
        create(:meeting, team: team, creator: user, status: "recording")
        create_list(:meeting, 2, team: team, creator: user, status: "pending")
        create(:meeting, team: team, creator: user, status: "completed")

        get "/api/v1/meetings"

        counts = response.parsed_body["meta"]["status_counts"]
        expect(counts["recording"]).to eq(1)
        expect(counts["pending"]).to eq(2)
        expect(counts["completed"]).to eq(1)
      end

      it "status_counts gives the full breakdown even when filtered by status" do
        create(:meeting, team: team, creator: user, status: "recording")
        create_list(:meeting, 2, team: team, creator: user, status: "pending")

        get "/api/v1/meetings", params: { status: "recording" }

        json = response.parsed_body
        expect(json["meetings"].length).to eq(1)
        expect(json["meta"]["total"]).to eq(1)
        expect(json["meta"]["status_counts"]["recording"]).to eq(1)
        expect(json["meta"]["status_counts"]["pending"]).to eq(2)
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

      it "다른 사용자가 만든 회의는 목록에 포함되지 않는다" do
        create(:meeting, team: team, creator: user, title: "내 회의")
        create(:meeting, :private_meeting, team: team, creator: other_user, title: "남의 회의")

        get "/api/v1/meetings"

        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("내 회의")
        expect(titles).not_to include("남의 회의")
      end

      it "admin은 모든 사용자의 회의를 본다" do
        admin = create(:user, role: "admin")
        create(:meeting, team: team, creator: other_user, title: "남의 회의")
        login_as(admin)

        get "/api/v1/meetings"

        titles = response.parsed_body["meetings"].map { |m| m["title"] }
        expect(titles).to include("남의 회의")
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

      it "creates meeting even without valid team_id (team is optional)" do
        post "/api/v1/meetings",
             params: { title: "New Meeting" },
             as: :json

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["meeting"]["title"]).to eq("New Meeting")
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

    context "접근 권한" do
      it "소유자가 아니고 참여자도 아니면 403 (비공개 회의)" do
        foreign = create(:meeting, :private_meeting, team: team, creator: other_user)
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:forbidden)
      end

      it "공유코드로 참여한 viewer는 조회 가능(200)" do
        foreign = create(:meeting, team: team, creator: other_user)
        create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:ok)
      end

      it "admin은 남의 회의도 조회 가능(200)" do
        foreign = create(:meeting, team: team, creator: other_user)
        login_as(create(:user, role: "admin"))
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:ok)
      end

      it "회의를 떠난(left_at 설정) 참여자는 더 이상 접근할 수 없다(403)" do
        foreign = create(:meeting, :private_meeting, team: team, creator: other_user)
        create(:meeting_participant, meeting: foreign, user: user, role: "viewer", left_at: Time.current)
        get "/api/v1/meetings/#{foreign.id}"
        expect(response).to have_http_status(:forbidden)
      end

      it "소유자는 자신의 회의에 접근 가능(200)" do
        mine = create(:meeting, team: team, creator: user)
        get "/api/v1/meetings/#{mine.id}"
        expect(response).to have_http_status(:ok)
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
        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["meeting"]["status"]).to eq("completed")
        expect(meeting.reload.status).to eq("completed")
        expect(meeting.reload.ended_at).not_to be_nil
      end

      it "enqueues MeetingFinalizerJob" do
        expect(MeetingFinalizerJob).to receive(:perform_later).with(meeting.id)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        post "/api/v1/meetings/#{meeting.id}/stop"
      end

      it "broadcasts recording_stopped to the meeting transcription stream" do
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)

        expect(ActionCable.server).to receive(:broadcast).with(
          "meeting_#{meeting.id}_transcription",
          hash_including(
            type: "recording_stopped",
            meeting_id: meeting.id
          )
        )

        post "/api/v1/meetings/#{meeting.id}/stop"
      end

      it "clears the recording lock for the meeting" do
        allow(MeetingFinalizerJob).to receive(:perform_later)
        allow(MeetingSummarizationJob).to receive(:perform_later)
        RecordingLock.acquire(meeting.id, "device-token")

        post "/api/v1/meetings/#{meeting.id}/stop"

        expect(RecordingLock.holder(meeting.id)).to be_nil
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
  # 제어 액션 인가
  # ============================================================
  describe "제어 액션 인가" do
    let(:foreign) { create(:meeting, team: team, creator: other_user, status: "pending") }

    it "viewer 참여자는 회의를 제어(start)할 수 없다(403)" do
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      post "/api/v1/meetings/#{foreign.id}/start"
      expect(response).to have_http_status(:forbidden)
    end

    it "viewer 참여자는 update할 수 없다(403)" do
      create(:meeting_participant, meeting: foreign, user: user, role: "viewer")
      patch "/api/v1/meetings/#{foreign.id}", params: { title: "해킹" }
      expect(response).to have_http_status(:forbidden)
      expect(foreign.reload.title).not_to eq("해킹")
    end
  end

  # ============================================================
  # POST /api/v1/meetings/move_to_folder
  # ============================================================
  describe "POST /api/v1/meetings/move_to_folder" do
    let(:folder) { create(:folder, team: team) }

    it "남의 회의는 폴더 이동되지 않는다" do
      foreign = create(:meeting, :private_meeting, team: team, creator: other_user, folder_id: nil)
      post "/api/v1/meetings/move_to_folder", params: { meeting_ids: [ foreign.id ], folder_id: folder.id }
      expect(foreign.reload.folder_id).to be_nil
    end

    it "내 회의는 폴더 이동된다" do
      mine = create(:meeting, team: team, creator: user, folder_id: nil)
      post "/api/v1/meetings/move_to_folder", params: { meeting_ids: [ mine.id ], folder_id: folder.id }
      expect(mine.reload.folder_id).to eq(folder.id)
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

RSpec.describe "Api::V1::Meetings summary options", type: :request do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let!(:admin_membership) { create(:team_membership, user: user, team: team, role: "admin") }

  before { login_as(user) }

  describe "POST /api/v1/meetings (요약 옵션)" do
    it "uses defaults (standard / restructure ON) for the first meeting" do
      post "/api/v1/meetings", params: { title: "첫 회의" }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("standard")
      expect(json["summary_restructure"]).to be true
    end

    it "accepts explicit summary options" do
      post "/api/v1/meetings",
           params: { title: "옵션 회의", summary_verbosity: "very_concise", summary_restructure: false }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("very_concise")
      expect(json["summary_restructure"]).to be false
    end

    it "inherits options from the creator's last meeting when params absent" do
      create(:meeting, team: team, creator: user,
             summary_verbosity: "detailed", summary_restructure: false, created_at: 1.hour.ago)

      post "/api/v1/meetings", params: { title: "승계 회의" }

      json = response.parsed_body["meeting"]
      expect(json["summary_verbosity"]).to eq("detailed")
      expect(json["summary_restructure"]).to be false
    end

    it "rejects invalid verbosity" do
      post "/api/v1/meetings", params: { title: "x", summary_verbosity: "ultra" }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "PATCH /api/v1/meetings/:id (요약 옵션)" do
    let(:meeting) { create(:meeting, team: team, creator: user) }

    it "updates summary options mid-meeting" do
      patch "/api/v1/meetings/#{meeting.id}",
            params: { summary_verbosity: "concise", summary_restructure: false }

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.summary_verbosity).to eq("concise")
      expect(meeting.summary_restructure).to be false
    end

    it "leaves options untouched when params absent" do
      meeting.update!(summary_verbosity: "detailed", summary_restructure: false)

      patch "/api/v1/meetings/#{meeting.id}", params: { title: "이름만 변경" }

      expect(meeting.reload.summary_verbosity).to eq("detailed")
      expect(meeting.summary_restructure).to be false
    end

    it "ignores blank summary_restructure (NOT NULL 컬럼 500 방지)" do
      patch "/api/v1/meetings/#{meeting.id}", params: { summary_restructure: "" }

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.summary_restructure).to be true
    end
  end
end
