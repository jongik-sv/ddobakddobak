require "rails_helper"

RSpec.describe "Api::V1::MeetingsAudio", type: :request do
  let(:user)       { create(:user) }
  let(:other_user) { create(:user) }
  let(:project)       { create(:project, creator: user) }
  let!(:membership) { create(:project_membership, user: user, project: project, role: "admin") }
  let(:meeting)    { create(:meeting, project: project, creator: user) }

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
  # 기밀 구간 절단 표식(meetings.transcripts_redacted_at) 이후의 오디오 writer 차단
  #
  # audio_file_path 를 쓰는 writer 는 3개인데 지금까지 AudioUploadJob 만 가드돼 있었다.
  # #create 는 자기가 읽은 소스가 그 사이 절단됐는지 확인 없이 set_audio_file! 하고,
  # #finalize 는 <id>_parts/ 를 이어붙여 <id>.webm 을 **재구성**한다 — 절단 전 청크가
  # 남아 있거나 절단 후 도착하면 파기한 기밀 오디오가 그대로 복원된다.
  # ─────────────────────────────────────────────────────────
  describe "절단된 회의의 오디오 쓰기 차단" do
    let(:audio_dir) { Rails.root.join("tmp", "test_audio_#{SecureRandom.hex(4)}").to_s }

    around do |example|
      prev = ENV["AUDIO_DIR"]
      ENV["AUDIO_DIR"] = audio_dir
      FileUtils.mkdir_p(audio_dir)
      example.run
    ensure
      prev.nil? ? ENV.delete("AUDIO_DIR") : ENV["AUDIO_DIR"] = prev
      FileUtils.rm_rf(audio_dir)
    end

    before { allow(AudioUploadJob).to receive(:perform_later) }

    def redact_marker!
      meeting.update!(transcripts_redacted_at: Time.current)
    end

    def chunk_file(content, seq)
      Rack::Test::UploadedFile.new(
        StringIO.new(content), "audio/webm;codecs=opus", true,
        original_filename: "chunk-#{seq}.webm"
      )
    end

    it "#create 는 409 + code=meeting_redacted 이고 파일도 audio_file_path 도 남기지 않는다" do
      redact_marker!

      post "/api/v1/meetings/#{meeting.id}/audio", params: { audio: webm_fixture }

      expect(response).to have_http_status(:conflict)
      # ⭐ 이 API 의 409 는 전부 재시도 가능(recorder 충돌 등)이라, 클라이언트가 "영구 거부"를
      # 구분하려면 안정된 코드가 필요하다. status 만 보면 무한 재시도에 갇힌다.
      expect(response.parsed_body["code"]).to eq("meeting_redacted")
      expect(meeting.reload.audio_file_path).to be_nil
      expect(Dir.glob(File.join(audio_dir, "*"))).to be_empty
      expect(AudioUploadJob).not_to have_received(:perform_later)
    end

    it "#chunk 는 409 이고 파트 파일이 디스크에 쌓이지 않는다" do
      # 파트를 계속 받으면 (a) finalize 가 그것으로 오디오를 재구성하고 (b) 파트 자체가
      # 어떤 스위퍼에도 안 잡히는 절단 전 기밀 바이트로 디스크에 남는다
      # (sweep_redact_backups! 는 *.redact-backup 만, AudioRedactor#audio_paths 는 _parts/ 제외).
      redact_marker!

      post "/api/v1/meetings/#{meeting.id}/audio_chunk",
           params: { chunk: chunk_file("기밀청크", 0), sequence: 0 }

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("meeting_redacted")
      expect(Dir.exist?(File.join(audio_dir, "#{meeting.id}_parts"))).to be false
    end

    it "#finalize 는 409 이고 남아 있는 파트로 오디오를 재구성하지 않는다" do
      # 절단 **전에** 이미 도착해 있던 파트가 남아 있는 상황.
      dir = File.join(audio_dir, "#{meeting.id}_parts")
      FileUtils.mkdir_p(dir)
      File.binwrite(File.join(dir, "0.part"), "절단전기밀오디오")
      redact_marker!

      post "/api/v1/meetings/#{meeting.id}/audio_finalize"

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("meeting_redacted")
      expect(File.exist?(File.join(audio_dir, "#{meeting.id}.webm"))).to be false
      expect(meeting.reload.audio_file_path).to be_nil
      expect(AudioUploadJob).not_to have_received(:perform_later)
    end

    it "recorder 충돌보다 절단 표식이 먼저 응답한다 (영구 거부가 일시적 409 에 가리면 안 된다)" do
      # ⭐ 배치 반증. reject_if_recorder_conflict! 도 **409** 라 status 로는 구분되지 않는다.
      # 절단 가드가 뒤로 밀리면 클라이언트는 재시도 가능한 recorder_conflict 만 보게 되고,
      # 그대로 무한 재시도에 갇혀 절단 전 오디오를 계속 밀어올린다. 순서가 계약이다.
      meeting.update!(status: "recording", recording_client_id: "device-a",
                      recording_client_platform: "desktop",
                      recorder_heartbeat_at: Time.current, # stale 아님 → 자가복구로 통과하지 않는다
                      transcripts_redacted_at: Time.current)

      post "/api/v1/meetings/#{meeting.id}/audio_chunk",
           params: { chunk: chunk_file("기밀청크", 0), sequence: 0 },
           headers: { "X-Client-Id" => "device-b", "X-Client-Platform" => "mobile" }

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("meeting_redacted")
      expect(Dir.exist?(File.join(audio_dir, "#{meeting.id}_parts"))).to be false
    end

    it "표식이 없으면 세 액션 모두 그대로 통과한다 (가드가 정상 녹음을 막지 않는다)" do
      post "/api/v1/meetings/#{meeting.id}/audio", params: { audio: webm_fixture }
      expect(response).to have_http_status(:created)

      post "/api/v1/meetings/#{meeting.id}/audio_chunk",
           params: { chunk: chunk_file("AAAA", 0), sequence: 0 }
      expect(response).to have_http_status(:ok)

      post "/api/v1/meetings/#{meeting.id}/audio_finalize"
      expect(response).to have_http_status(:ok)
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

      it "200 OK, webm 스트리밍 응답" do
        get "/api/v1/meetings/#{meeting.id}/audio"

        expect(response).to have_http_status(:ok)
        # Rack::Mime maps .webm to video/webm
        expect(response.content_type).to include("webm")
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
