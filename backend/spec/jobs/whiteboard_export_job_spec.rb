require "rails_helper"

RSpec.describe WhiteboardExportJob, type: :job do
  let(:user) { create(:user) }
  let(:meeting) { create(:meeting, creator: user, started_at: Time.utc(2026, 7, 14, 20, 0)) }
  let!(:summary) { create(:summary, meeting: meeting, notes_markdown: "# 노트") }
  let(:digest) { Whiteboard::Material.build(meeting).digest }
  let!(:wb) { MeetingWhiteboard.create!(meeting: meeting, status: "running", digest: digest, run_token: "tok") }
  let(:good) do
    { title: "t", date: "2026-07-15", headline: "h",
      zones: [ { title: "z", kind: "decision", items: [ { text: "a", tag: "확정", who: nil, due: nil } ] } ] }.to_json
  end

  before do
    allow(LlmService).to receive(:claude_cli_available?).and_return(true)
    allow(ActionCable.server).to receive(:broadcast)
  end

  def run_job = described_class.perform_now(meeting.id, digest, user.id, "tok")

  it "성공: 펜스 제거하고 저장 + whiteboard_ready broadcast" do
    allow(LlmService).to receive(:run_claude_whiteboard).and_return("```json\n#{good}\n```")
    run_job
    wb.reload
    expect(wb.status).to eq("done")
    expect(wb.board["zones"][0]["kind"]).to eq("decision")
    expect(ActionCable.server).to have_received(:broadcast)
      .with(meeting.transcription_stream, { type: "whiteboard_ready", meeting_id: meeting.id, digest: digest })
  end

  it "형식 실패 후 재요청 1회로 성공 (재요청에 오류 접미)" do
    calls = []
    allow(LlmService).to receive(:run_claude_whiteboard) do |system_prompt:, user_content:, timeout:|
      calls << user_content
      calls.size == 1 ? "죄송합니다" : good
    end
    run_job
    expect(calls.size).to eq(2)
    expect(calls[1]).to include("[이전 응답 오류]")
    expect(wb.reload.status).to eq("done")
  end

  it "재요청 후에도 실패하면 format" do
    allow(LlmService).to receive(:run_claude_whiteboard).and_return("엉터리")
    run_job
    expect(wb.reload).to have_attributes(status: "error", error_kind: "format")
    expect(ActionCable.server).to have_received(:broadcast)
      .with(meeting.transcription_stream, hash_including(type: "whiteboard_failed", error_kind: "format"))
  end

  it "exit 0 인데 로그인 안내면 재요청 없이 auth" do
    expect(LlmService).to receive(:run_claude_whiteboard).once.and_return("Not logged in. Please run /login")
    run_job
    expect(wb.reload.error_kind).to eq("auth")
  end

  it "CLI 실패 stderr 로 auth 분류" do
    allow(LlmService).to receive(:run_claude_whiteboard).and_raise(LlmService::CliError.new("fail", stderr: "401 authentication_error"))
    run_job
    expect(wb.reload.error_kind).to eq("auth")
  end

  it "timeout 분류" do
    allow(LlmService).to receive(:run_claude_whiteboard).and_raise(LlmService::CliTimeoutError, "CLI 응답 시간이 초과되었습니다")
    run_job
    expect(wb.reload.error_kind).to eq("timeout")
  end

  it "claude 없음이면 not_found" do
    allow(LlmService).to receive(:claude_cli_available?).and_return(false)
    run_job
    expect(wb.reload.error_kind).to eq("not_found")
  end

  it "그사이 재요약되어 digest 가 달라지면 현재 digest 로 저장" do
    allow(LlmService).to receive(:run_claude_whiteboard).and_return(good)
    old = digest
    summary.update!(notes_markdown: "# 바뀐 노트")
    described_class.perform_now(meeting.id, old, user.id, "tok")
    expect(wb.reload.digest).to eq(Whiteboard::Material.build(meeting.reload).digest)
    expect(wb.digest).not_to eq(old)
  end

  it "전용 whiteboard 큐를 쓴다" do
    expect(described_class.new.queue_name).to eq("whiteboard")
  end

  it "토큰이 다르면(대체된 실행) 아무것도 하지 않는다" do
    expect(LlmService).not_to receive(:run_claude_whiteboard)
    described_class.perform_now(meeting.id, digest, user.id, "old-token")
    expect(wb.reload.status).to eq("running")
    expect(ActionCable.server).not_to have_received(:broadcast)
  end

  it "실행 중 토큰이 바뀌면(재enqueue) 결과를 쓰지 않고 broadcast 도 안 한다" do
    allow(LlmService).to receive(:run_claude_whiteboard) do
      wb.update_columns(run_token: "new-token")
      good
    end
    run_job
    expect(wb.reload).to have_attributes(status: "running", board_json: nil, run_token: "new-token")
    expect(ActionCable.server).not_to have_received(:broadcast)
  end

  it "토큰이 바뀐 뒤의 실패도 쓰지 않는다" do
    allow(LlmService).to receive(:run_claude_whiteboard) do
      wb.update_columns(run_token: "new-token")
      raise LlmService::CliTimeoutError, "t"
    end
    run_job
    expect(wb.reload.status).to eq("running")
    expect(ActionCable.server).not_to have_received(:broadcast)
  end

  it "CLI 실패 stdout_tail 의 로그인 안내로 auth 분류" do
    allow(LlmService).to receive(:run_claude_whiteboard)
      .and_raise(LlmService::CliError.new("fail", stderr: "", stdout_tail: "Please run /login"))
    run_job
    expect(wb.reload.error_kind).to eq("auth")
  end
end
