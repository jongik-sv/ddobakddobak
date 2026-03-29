require "rails_helper"

RSpec.describe "Api::V1::MeetingsAudio", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:team)       { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "admin") }
  let(:meeting)    { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  def uploaded_file(content_type: "audio/webm", content: "\x1A\x45\xDF\xA3" + ("x" * 100), filename: "test.webm")
    Rack::Test::UploadedFile.new(
      StringIO.new(content),
      content_type,
      true,
      original_filename: filename
    )
  end

  def webm_fixture
    # 최소한의 유효한 WebM 바이너리 헤더 (EBML 매직 넘버)
    uploaded_file
  end

  # ─────────────────────────────────────────────────────────
  # POST /api/v1/meetings/:id/audio
  # ─────────────────────────────────────────────────────────
  describe "POST /api/v1/meetings/:id/audio" do
    context "정상 케이스" do
      it "201 Created, audio_available 반환" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: webm_fixture }

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["audio_available"]).to be true
      end

      it "meetings.audio_file_path가 DB에 저장됨" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: webm_fixture }

        expect(response).to have_http_status(:created)
        meeting.reload
        expect(meeting.audio_file_path).to be_present
        expect(meeting.audio_file_path).to include("#{meeting.id}.webm")
      end

      it "AudioUploadJob이 큐에 등록됨" do
        expect(AudioUploadJob).to receive(:perform_later).with(meeting_id: meeting.id)

        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: webm_fixture }
      end

      it "video/webm content_type도 허용됨" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: uploaded_file(content_type: "video/webm") }

        expect(response).to have_http_status(:created)
      end

      it "audio/ogg content_type도 허용됨" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: uploaded_file(content_type: "audio/ogg", content: "OggS" + ("x" * 100), filename: "test.ogg") }

        expect(response).to have_http_status(:created)
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        post "/api/v1/meetings/999999/audio",
             params: { audio: webm_fixture }

        expect(response).to have_http_status(:not_found)
      end
    end

    context "잘못된 파일 타입" do
      it "422 Unprocessable Entity 반환" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: { audio: uploaded_file(content_type: "audio/mpeg", content: "ID3" + ("x" * 100), filename: "test.mp3") }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(response.parsed_body["error"]).to include("WebM")
      end
    end

    context "audio 파라미터 누락" do
      it "400 Bad Request 반환" do
        post "/api/v1/meetings/#{meeting.id}/audio",
             params: {}

        expect(response).to have_http_status(:bad_request)
      end
    end
  end

  # ─────────────────────────────────────────────────────────
  # GET /api/v1/meetings/:id/audio
  # ─────────────────────────────────────────────────────────
  describe "GET /api/v1/meetings/:id/audio" do
    context "오디오 파일이 존재하는 경우" do
      let(:audio_path) do
        path = Rails.root.join("storage", "audio", "#{meeting.id}.webm").to_s
        FileUtils.mkdir_p(File.dirname(path))
        File.write(path, "\x1A\x45\xDF\xA3" + ("x" * 100))
        path
      end

      before do
        meeting.update!(audio_file_path: audio_path)
      end

      after do
        FileUtils.rm_f(audio_path)
      end

      it "200 OK, audio/webm 스트리밍 응답" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:ok)
        expect(response.content_type).to include("audio/webm")
      end
    end

    context "오디오 파일이 없는 경우 (audio_file_path nil)" do
      it "404 Not Found 반환" do
        meeting.update!(audio_file_path: nil)

        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body["error"]).to eq("Audio not found")
      end
    end

    context "오디오 파일 경로는 있지만 파일이 존재하지 않는 경우" do
      it "404 Not Found 반환" do
        meeting.update!(audio_file_path: "/nonexistent/path/audio.webm")

        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body["error"]).to eq("Audio not found")
      end
    end

    context "존재하지 않는 meeting" do
      it "404 Not Found 반환" do
        get "/api/v1/meetings/999999/audio"

        expect(response).to have_http_status(:not_found)
      end
    end
  end
end
