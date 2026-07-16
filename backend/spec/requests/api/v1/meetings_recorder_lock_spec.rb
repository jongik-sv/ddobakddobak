require "rails_helper"

# 단일 녹음 기기 락: 한 회의의 녹음 제어(시작/일시정지/재개/종료/청크 업로드)는
# 점유 기기(recording_client_id == X-Client-Id)에서만 가능하다.
# 다른 기기는 점유 하트비트가 신선하면 409(recorder_conflict), stale(90s 초과)이면
# 자가복구(heal_stale_recording!) 후 기존 상태 검증 의미로 응답한다. 강제 탈취 경로는 없다.
RSpec.describe "Api::V1::Meetings 단일 녹음 기기 락", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  let(:device_a) { { "X-Client-Id" => "device-a", "X-Client-Platform" => "desktop" } }
  let(:device_b) { { "X-Client-Id" => "device-b", "X-Client-Platform" => "mobile" } }

  before { login_as(user) }

  # device-a 가 점유 중인 활성(하트비트 신선) recording 회의
  def create_active_recording(attrs = {})
    create(:meeting, project: project, creator: user, status: "recording",
           recording_client_id: "device-a", recording_client_platform: "desktop",
           recorder_heartbeat_at: Time.current, **attrs)
  end

  # ============================================================
  # (a) 다른 기기의 제어 → 409 recorder_conflict
  # ============================================================
  describe "다른 기기의 제어 요청 (점유 하트비트 신선)" do
    it "stop 은 409 + code=recorder_conflict 이고 상태는 recording 유지" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/stop", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
      expect(response.parsed_body["error"]).to eq("다른 기기에서 녹음이 진행 중입니다.")
      expect(m.reload.status).to eq("recording")
    end

    it "pause 는 409 이고 paused_at 이 세팅되지 않는다" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/pause", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
      expect(m.reload.paused_at).to be_nil
    end

    it "resume 은 409 이고 paused_at 이 풀리지 않는다" do
      m = create_active_recording(paused_at: 1.minute.ago)

      post "/api/v1/meetings/#{m.id}/resume", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(m.reload.paused_at).to be_present
    end

    it "X-Client-Id 헤더 없는 요청도 점유 기기와 다르므로 409" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/stop"

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
    end

    it "admin 이라도 다른 기기면 409 (강제 탈취 경로 없음)" do
      m = create_active_recording
      login_as(create(:user, :admin))

      post "/api/v1/meetings/#{m.id}/stop", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(m.reload.status).to eq("recording")
    end

    it "recording_client_id 가 nil 인 레거시 recording 회의는 가드를 통과한다" do
      legacy = create(:meeting, project: project, creator: user, status: "recording",
                      recording_client_id: nil, recorder_heartbeat_at: Time.current)

      post "/api/v1/meetings/#{legacy.id}/stop", headers: device_b

      expect(response).to have_http_status(:ok)
      expect(legacy.reload.status).to eq("completed")
    end
  end

  # ============================================================
  # (b) 같은 기기(점유 기기)는 정상 동작
  # ============================================================
  describe "점유 기기의 제어 요청" do
    it "stop 은 200 으로 정상 종료된다" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/stop", headers: device_a

      expect(response).to have_http_status(:ok)
      expect(m.reload.status).to eq("completed")
    end

    it "pause → resume 이 정상 동작한다" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/pause", headers: device_a
      expect(response).to have_http_status(:ok)
      expect(m.reload.paused_at).to be_present

      post "/api/v1/meetings/#{m.id}/resume", headers: device_a
      expect(response).to have_http_status(:ok)
      expect(m.reload.paused_at).to be_nil
    end
  end

  # ============================================================
  # (c) 점유 하트비트 stale → heal 후 기존 상태 검증 의미
  # ============================================================
  describe "점유 기기 하트비트가 stale(90s 초과)인 경우" do
    it "다른 기기의 stop 은 자가복구로 completed 종결 후 기존 의미의 422" do
      m = create_active_recording(recorder_heartbeat_at: 5.minutes.ago)

      post "/api/v1/meetings/#{m.id}/stop", headers: device_b

      # 가드가 heal_stale_recording! 로 이미 종결 → stop 의 recording 상태 검증이 422
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("Meeting is not in recording state")
      expect(m.reload.status).to eq("completed")
    end

    it "자가복구 후 다른 기기가 reopen 으로 이어받을 수 있다(락 해제 효과)" do
      m = create_active_recording(recorder_heartbeat_at: 5.minutes.ago)

      post "/api/v1/meetings/#{m.id}/stop", headers: device_b   # heal → 422
      post "/api/v1/meetings/#{m.id}/reopen", headers: device_b

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("recording")
      expect(m.recording_client_id).to eq("device-b")
    end
  end

  # ============================================================
  # (d) reopen 의 점유 기기 재도장
  # ============================================================
  describe "reopen 의 점유 기기 재도장" do
    it "completed 회의를 reopen 하면 요청 기기가 새 recorder 가 된다" do
      m = create(:meeting, project: project, creator: user, status: "completed",
                 ended_at: 1.hour.ago,
                 recording_client_id: "device-a", recording_client_platform: "desktop",
                 recorder_heartbeat_at: 1.hour.ago)

      post "/api/v1/meetings/#{m.id}/reopen", headers: device_b

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("recording")
      expect(m.ended_at).to be_nil
      expect(m.recording_client_id).to eq("device-b")
      expect(m.recording_client_platform).to eq("mobile")
      expect(m.recorder_heartbeat_at).to be > 1.minute.ago
    end

    it "reopen 으로 이어받은 뒤 이전 기기의 제어는 409" do
      m = create(:meeting, project: project, creator: user, status: "completed",
                 ended_at: 1.hour.ago, recording_client_id: "device-a")

      post "/api/v1/meetings/#{m.id}/reopen", headers: device_b
      post "/api/v1/meetings/#{m.id}/stop", headers: device_a

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
    end

    it "다른 기기가 활성 recording 중이면 reopen 은 409 (방어)" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/reopen", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(m.reload.recording_client_id).to eq("device-a")
    end
  end

  # ============================================================
  # (e) start 의 기기 충돌 (원자 전이)
  # ============================================================
  describe "start 의 기기 충돌" do
    it "다른 기기가 활성 recording 중인 회의의 start 는 409 recorder_conflict" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/start", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
      expect(m.reload.recording_client_id).to eq("device-a")
    end

    it "같은 기기라도 이미 recording 이면 기존 의미의 422" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/start", headers: device_a

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("Meeting is not in pending state")
    end

    it "stale recording 회의의 start 는 409 가 아니라 기존 의미의 422" do
      m = create_active_recording(recorder_heartbeat_at: 5.minutes.ago)

      post "/api/v1/meetings/#{m.id}/start", headers: device_b

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "pending 회의 start 는 점유 기기를 도장하고 recording 으로 전이한다" do
      m = create(:meeting, project: project, creator: user, status: "pending")

      post "/api/v1/meetings/#{m.id}/start", headers: device_b

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("recording")
      expect(m.recording_client_id).to eq("device-b")
      expect(m.recording_client_platform).to eq("mobile")
      expect(m.recorder_heartbeat_at).to be_present
    end
  end

  # ============================================================
  # (f) 오디오 REST 업로드(모바일 청크 경로) 가드
  # ============================================================
  describe "오디오 업로드(REST) 가드" do
    let(:meeting) { create_active_recording }

    after do
      audio_dir = ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
      FileUtils.rm_rf(File.join(audio_dir, "#{meeting.id}_parts"))
    end

    def chunk(content, seq)
      Rack::Test::UploadedFile.new(
        StringIO.new(content), "audio/webm;codecs=opus", true,
        original_filename: "chunk-#{seq}.webm"
      )
    end

    it "다른 기기의 chunk 업로드는 409" do
      post "/api/v1/meetings/#{meeting.id}/audio_chunk",
           params: { chunk: chunk("AAAA", 0), sequence: 0 }, headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
    end

    it "점유 기기의 chunk 업로드는 200" do
      post "/api/v1/meetings/#{meeting.id}/audio_chunk",
           params: { chunk: chunk("AAAA", 0), sequence: 0 }, headers: device_a

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["received"]).to eq(0)
    end

    it "다른 기기의 finalize 는 409" do
      post "/api/v1/meetings/#{meeting.id}/audio_finalize", headers: device_b

      expect(response).to have_http_status(:conflict)
    end

    it "다른 기기의 audio(create) 는 409" do
      post "/api/v1/meetings/#{meeting.id}/audio", headers: device_b

      expect(response).to have_http_status(:conflict)
    end
  end

  # ============================================================
  # (g) meeting_json 계약 필드 (paused_at / recording_client_id / recorder_active)
  # ============================================================
  describe "meeting_json 계약 필드" do
    it "show 응답에 paused_at / recording_client_id / recorder_active 를 포함한다" do
      m = create_active_recording(paused_at: Time.current)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body["meeting"]
      expect(json["paused_at"]).to be_present
      expect(json["recording_client_id"]).to eq("device-a")
      expect(json["recorder_active"]).to be true
    end

    it "list(index) 응답에도 포함되며 completed 회의는 recorder_active=false" do
      m = create(:meeting, project: project, creator: user, status: "completed",
                 recording_client_id: "device-a")

      get "/api/v1/meetings", params: { show_all: true }

      json = response.parsed_body["meetings"].find { |x| x["id"] == m.id }
      expect(json).to have_key("paused_at")
      expect(json["paused_at"]).to be_nil
      expect(json["recording_client_id"]).to eq("device-a")
      expect(json["recorder_active"]).to be false
    end
  end

  # ============================================================
  # (h) reset_content 의 녹음 기기 락 정리 + 다른 기기 가드
  # ============================================================
  describe "reset_content 의 녹음 기기 락 정리" do
    it "다른 기기가 활성 recording 회의를 reset 하면 409 recorder_conflict" do
      m = create_active_recording

      post "/api/v1/meetings/#{m.id}/reset_content", headers: device_b

      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("recorder_conflict")
      # 가드에 막혀 상태·점유 기기가 그대로 유지된다.
      m.reload
      expect(m.status).to eq("recording")
      expect(m.recording_client_id).to eq("device-a")
    end

    it "점유 기기(같은 기기)의 reset 은 통과하고 녹음 기기 락 필드를 모두 비운다" do
      m = create_active_recording(paused_at: 1.minute.ago)
      RecordingLock.acquire(m.id, "tok-a") # 옛 커넥션의 인프로세스 락 시뮬레이션

      post "/api/v1/meetings/#{m.id}/reset_content", headers: device_a

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("pending")
      expect(m.paused_at).to be_nil
      expect(m.recording_client_id).to be_nil
      expect(m.recording_client_platform).to be_nil
      expect(m.recorder_heartbeat_at).to be_nil
      expect(RecordingLock.holder(m.id)).to be_nil
    end

    it "완료(비녹음) 회의는 다른 기기가 reset 해도 통과한다" do
      m = create(:meeting, project: project, creator: user, status: "completed",
                 ended_at: 1.hour.ago, recording_client_id: "device-a",
                 recording_client_platform: "desktop", recorder_heartbeat_at: 1.hour.ago)
      RecordingLock.acquire(m.id, "tok-a")

      post "/api/v1/meetings/#{m.id}/reset_content", headers: device_b

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("pending")
      expect(m.recording_client_id).to be_nil
      expect(m.recorder_heartbeat_at).to be_nil
      expect(RecordingLock.holder(m.id)).to be_nil
    end

    it "stale recording 회의는 다른 기기가 reset 하면 heal 후 통과한다" do
      m = create_active_recording(recorder_heartbeat_at: 5.minutes.ago)

      post "/api/v1/meetings/#{m.id}/reset_content", headers: device_b

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("pending")
      expect(m.recording_client_id).to be_nil
    end
  end

  # ============================================================
  # (i) start/reopen 후 paused_at 정리 ("recording+paused" 유령 상태 방지)
  # ============================================================
  describe "start/reopen 후 paused_at 정리" do
    it "pending 회의에 paused_at 이 잔존해도 start 후 nil 이 된다" do
      m = create(:meeting, project: project, creator: user, status: "pending",
                 paused_at: 1.minute.ago)

      post "/api/v1/meetings/#{m.id}/start", headers: device_a

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("recording")
      expect(m.paused_at).to be_nil
    end

    it "completed 회의에 paused_at 이 잔존해도 reopen 후 nil 이 된다" do
      m = create(:meeting, project: project, creator: user, status: "completed",
                 ended_at: 1.hour.ago, paused_at: 1.minute.ago,
                 recording_client_id: "device-a", recorder_heartbeat_at: 1.hour.ago)

      post "/api/v1/meetings/#{m.id}/reopen", headers: device_a

      expect(response).to have_http_status(:ok)
      m.reload
      expect(m.status).to eq("recording")
      expect(m.paused_at).to be_nil
    end
  end
end
