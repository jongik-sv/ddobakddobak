require "rails_helper"
require "tmpdir"

RSpec.describe "Api::V1::MeetingWhiteboards", type: :request do
  let(:user) { create(:user) }
  let(:other) { create(:user) }
  let(:meeting) { create(:meeting, creator: user, started_at: Time.utc(2026, 7, 14, 20, 0)) }
  let(:tmp_dir) { Dir.mktmpdir("wb-req") }
  let(:tmp_path) { File.join(tmp_dir, "settings.yaml") }
  let(:mode) { "server_claude" }
  let(:digest) { Whiteboard::Material.build(meeting).digest }
  let(:board) do
    { "title" => "t", "date" => "d", "headline" => "h",
      "zones" => [ { "title" => "z", "kind" => "topic", "items" => [ { "text" => "a", "tag" => nil, "who" => nil, "due" => nil } ] } ] }
  end

  before do
    AppSettings # 상수 로드 후 격리
    stub_const("AppSettings::SETTINGS_PATH", tmp_path)
    File.write(tmp_path, YAML.dump("whiteboard" => { "web_mode" => mode }))
    allow(LlmService).to receive(:claude_cli_available?).and_return(true)
    login_as(user)
  end

  after { FileUtils.remove_entry(tmp_dir) if File.exist?(tmp_dir) }

  def post_wb(m = meeting) = post("/api/v1/meetings/#{m.id}/whiteboard")
  def get_wb(m = meeting) = get("/api/v1/meetings/#{m.id}/whiteboard")

  describe "POST" do
    context "web_mode copy" do
      let(:mode) { "copy" }
      it "403" do
        create(:summary, meeting: meeting, notes_markdown: "x")
        post_wb
        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["error"]).to eq("whiteboard_server_disabled")
      end
    end

    it "web_mode 설정이 없으면 기본값 server_claude 로 허용(202)" do
      File.delete(tmp_path)
      create(:summary, meeting: meeting, notes_markdown: "x")
      post_wb
      expect(response).to have_http_status(:accepted)
    end

    it "서버에 claude 없으면 403" do
      allow(LlmService).to receive(:claude_cli_available?).and_return(false)
      create(:summary, meeting: meeting, notes_markdown: "x")
      post_wb
      expect(response).to have_http_status(:forbidden)
    end

    it "요약 없으면 422" do
      post_wb
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("no_summary")
    end

    it "202 + enqueue + running 저장" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      expect { post_wb }.to have_enqueued_job(WhiteboardExportJob).with(meeting.id, digest, user.id, a_string_matching(/\A\h{32}\z/))
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body).to eq("status" => "running", "digest" => digest)
      expect(meeting.reload.meeting_whiteboard).to have_attributes(status: "running", requested_by_id: user.id)
    end

    it "running 이고 digest 같으면 202, 중복 enqueue 없음" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest)
      expect { post_wb }.not_to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:accepted)
    end

    it "done 이고 digest 같으면 200 캐시 적중, 잡 없음" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "done", digest: digest, board_json: board.to_json)
      expect { post_wb }.not_to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("status" => "done", "digest" => digest, "board" => board)
    end

    it "done 이어도 digest 다르면 재생성" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "done", digest: "old", board_json: board.to_json)
      expect { post_wb }.to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:accepted)
      expect(meeting.reload.meeting_whiteboard.board_json).to be_nil
    end

    it "enqueue 시 run_token 을 발급해 row 와 잡 인자에 같이 넣는다" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      post_wb
      token = meeting.reload.meeting_whiteboard.run_token
      expect(token).to match(/\A\h{32}\z/)
      expect(WhiteboardExportJob).to have_been_enqueued.with(meeting.id, digest, user.id, token)
    end

    it "running 이 7분 넘게 고착되면 같은 digest 라도 재enqueue + 새 토큰" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      wb = MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest, run_token: "old")
      wb.update_columns(updated_at: 8.minutes.ago)
      expect { post_wb }.to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:accepted)
      expect(wb.reload.run_token).not_to eq("old")
      expect(wb.updated_at).to be > 1.minute.ago
    end

    it "저장 보드가 현재 검증을 통과하지 못하면 캐시 미스로 재생성" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      bad = { "title" => "t", "date" => "d", "headline" => "h", "zones" => [] }
      MeetingWhiteboard.create!(meeting: meeting, status: "done", digest: digest, board_json: bad.to_json)
      expect { post_wb }.to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:accepted)
    end

    it "row 가 이미 있으면(create 의 RecordNotUnique 경로) 500 없이 기존 row 를 재조회해 판정" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest, run_token: "t")
      expect { post_wb }.not_to have_enqueued_job(WhiteboardExportJob)
      expect(response).to have_http_status(:accepted)
    end

    it "접근 권한 없는 사용자는 403" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      login_as(other)
      post_wb
      expect(response).to have_http_status(:forbidden)
    end

    it "없는 회의는 404" do
      post "/api/v1/meetings/0/whiteboard"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET" do
    it "none" do
      get_wb
      expect(response.parsed_body).to eq("status" => "none", "stale" => false)
    end

    it "done (stale false) 은 web_mode copy 여도 조회 가능" do
      File.write(tmp_path, YAML.dump("whiteboard" => { "web_mode" => "copy" }))
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "done", digest: digest, board_json: board.to_json)
      get_wb
      expect(response.parsed_body).to eq("status" => "done", "digest" => digest, "board" => board, "stale" => false)
    end

    it "done 인데 회의록이 바뀌면 stale true" do
      s = create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "done", digest: digest, board_json: board.to_json)
      s.update!(notes_markdown: "y")
      get_wb
      expect(response.parsed_body["stale"]).to eq(true)
    end

    it "error 는 kind·message 포함" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "error", digest: digest, error_kind: "auth", error_message: "m")
      get_wb
      expect(response.parsed_body).to include("status" => "error", "error_kind" => "auth", "error_message" => "m")
    end

    it "7분 넘게 고착된 running 은 error/timeout 으로 보고(저장은 안 함)" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      wb = MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest)
      wb.update_columns(updated_at: 8.minutes.ago)
      get_wb
      expect(response.parsed_body).to include("status" => "error", "error_kind" => "timeout")
      expect(wb.reload.status).to eq("running")
    end

    it "최근 running 은 그대로 running" do
      create(:summary, meeting: meeting, notes_markdown: "x")
      MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest)
      get_wb
      expect(response.parsed_body["status"]).to eq("running")
    end

    it "권한 없는 사용자 403" do
      login_as(other)
      get_wb
      expect(response).to have_http_status(:forbidden)
    end
  end
end
