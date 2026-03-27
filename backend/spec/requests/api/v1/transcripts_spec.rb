require "rails_helper"

RSpec.describe "Api::V1::Transcripts", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "admin") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }

  def auth_headers(u = user)
    post "/api/v1/login", params: { email: u.email, password: "password123" }, as: :json
    token = response.parsed_body["token"]
    { "Authorization" => "Bearer #{token}" }
  end

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
        get "/api/v1/meetings/#{meeting.id}/transcripts",
            headers: auth_headers

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to be_an(Array)
        expect(json["transcripts"].length).to eq(2)
      end

      it "sequence_number 순서로 정렬" do
        get "/api/v1/meetings/#{meeting.id}/transcripts",
            headers: auth_headers

        json = response.parsed_body
        contents = json["transcripts"].map { |t| t["content"] }
        expect(contents).to eq(["첫 번째", "두 번째"])
      end

      it "각 트랜스크립트에 필수 필드 포함" do
        get "/api/v1/meetings/#{meeting.id}/transcripts",
            headers: auth_headers

        json = response.parsed_body
        transcript = json["transcripts"].first
        expect(transcript).to include(
          "id", "speaker_label", "content", "started_at_ms", "ended_at_ms", "sequence_number"
        )
        expect(transcript["started_at_ms"]).to eq(0)
        expect(transcript["ended_at_ms"]).to eq(3000)
        expect(transcript["speaker_label"]).to eq("SPEAKER_00")
      end
    end

    context "트랜스크립트가 없는 경우" do
      it "빈 배열 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts",
            headers: auth_headers

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["transcripts"]).to eq([])
      end
    end

    context "비인증" do
      it "401 Unauthorized 반환" do
        get "/api/v1/meetings/#{meeting.id}/transcripts"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "비멤버" do
      it "404 Not Found 반환 (팀 스코프 밖)" do
        get "/api/v1/meetings/#{meeting.id}/transcripts",
            headers: auth_headers(other_user)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/999999/transcripts",
            headers: auth_headers

        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
