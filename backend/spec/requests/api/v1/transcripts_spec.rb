require "rails_helper"

RSpec.describe "Api::V1::Transcripts", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:project)       { create(:project, creator: user) }
  let!(:membership) { create(:project_membership, user: user, project: project, role: "admin") }
  let(:meeting)    { create(:meeting, project: project, creator: user) }

  before { login_as(user) }

  # ─────────────────────────────────────────────────────────
  # GET /api/v1/meetings/:id/transcripts
  # ─────────────────────────────────────────────────────────
  describe "GET /api/v1/meetings/:id/transcripts" do
    context "트랜스크립트가 있는 경우" do
      before do
        create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 번째", speaker_label: "SPEAKER_00", started_at_ms: 0, ended_at_ms: 3000)
        create(:transcript, meeting: meeting, sequence_number: 2, content: "두 번째", speaker_label: "SPEAKER_01", started_at_ms: 3000, ended_at_ms: 6000)
      end

      it "200 OK, transcripts 배열 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to be_an(Array)
        expect(json["transcripts"].length).to eq(2)
      end

      it "sequence_number 순서로 정렬" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        contents = json["transcripts"].map { |t| t["content"] }
        expect(contents).to eq([ "첫 번째", "두 번째" ])
      end

      it "각 트랜스크립트에 필수 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        transcript = json["transcripts"].first
        expect(transcript).to include(
          "id", "speaker_label", "content", "started_at_ms", "ended_at_ms", "sequence_number"
        )
        expect(transcript["started_at_ms"]).to eq(0)
        expect(transcript["ended_at_ms"]).to eq(3000)
        expect(transcript["speaker_label"]).to eq("SPEAKER_00")
      end

      it "speaker_name 필드를 포함한다 (미설정 시 null)" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        json = response.parsed_body
        transcript = json["transcripts"].first
        expect(transcript).to have_key("speaker_name")
        expect(transcript["speaker_name"]).to be_nil
      end
    end

    context "트랜스크립트가 없는 경우" do
      it "빈 배열 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to eq([])
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/999999/transcripts"

        expect(response).to have_http_status(:not_found)
      end
    end

    context "접근 권한" do
      let(:foreign) { create(:meeting, :private_meeting, creator: other_user) }

      it "비참여자는 남의 회의 transcripts에 접근할 수 없다(403)" do
        get "/api/v1/meetings/#{foreign.id}/transcripts"
        expect(response).to have_http_status(:forbidden)
      end

      it "읽기 가시성 멤버(비소유자)는 transcripts 조회 가능(200)" do
        foreign.update!(shared: true)
        create(:project_membership, project: foreign.project, user: user)
        get "/api/v1/meetings/#{foreign.id}/transcripts"
        expect(response).to have_http_status(:ok)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content
  # ─────────────────────────────────────────────────────────
  describe "PATCH /api/v1/meetings/:meeting_id/transcripts/:id/update_content" do
    include ActiveJob::TestHelper

    let!(:transcript) do
      create(:transcript, meeting: meeting, sequence_number: 1,
             content: "원본 텍스트", speaker_label: "SPEAKER_00",
             started_at_ms: 0, ended_at_ms: 3000)
    end

    context "정상 요청" do
      it "200 OK, content 갱신" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "수정된 텍스트", client_id: "abc-123" }

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcript"]["content"]).to eq("수정된 텍스트")
        expect(transcript.reload.content).to eq("수정된 텍스트")
      end

      it "meeting.last_user_edit_at 갱신" do
        freeze_time = Time.zone.parse("2026-05-18 10:00:00")
        travel_to(freeze_time) do
          patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
                params: { content: "수정", client_id: "c1" }
        end
        expect(meeting.reload.last_user_edit_at).to be_within(1.second).of(freeze_time)
      end

      it "ActionCable broadcast 발행" do
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream,
          hash_including(
            type: "transcript_updated",
            id: transcript.id,
            content: "수정",
            client_id: "c1"
          )
        )
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "수정", client_id: "c1" }
      end

      it "content 수정 시 EmbedBackfillJob을 meeting_id로 enqueue한다" do
        expect {
          patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
                params: { content: "수정된 텍스트", client_id: "abc-123" }
        }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: transcript.meeting_id)
      end
    end

    context "공백만 들어온 경우" do
      it "422 반환, content 그대로" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "   " }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(transcript.reload.content).to eq("원본 텍스트")
      end
    end

    context "길이 상한(5000자) 초과" do
      it "422 반환" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{transcript.id}/update_content",
              params: { content: "x" * 5001 }

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "다른 회의의 transcript id" do
      let(:other_meeting) { create(:meeting, project: project, creator: user) }
      let!(:other_transcript) do
        create(:transcript, meeting: other_meeting, sequence_number: 1,
               content: "다른 회의", speaker_label: "SPEAKER_00",
               started_at_ms: 0, ended_at_ms: 1000)
      end

      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/#{other_transcript.id}/update_content",
              params: { content: "해킹 시도" }

        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 transcript" do
      it "404 Not Found" do
        patch "/api/v1/meetings/#{meeting.id}/transcripts/999999/update_content",
              params: { content: "x" }

        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
