require "rails_helper"

RSpec.describe "Api::V1::MeetingsAudio 청크 업로드", type: :request do
  let(:user)    { create(:user) }
  let(:project)    { create(:project, creator: user) }
  let!(:member) { create(:project_membership, user: user, project: project, role: "admin") }
  let(:meeting) { create(:meeting, project: project, creator: user) }

  before do
    login_as(user)
    allow(AudioUploadJob).to receive(:perform_later)
  end

  after do
    audio_dir = ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
    FileUtils.rm_rf(File.join(audio_dir, "#{meeting.id}_parts"))
    FileUtils.rm_f(File.join(audio_dir, "#{meeting.id}.webm"))
  end

  def chunk(content, seq)
    Rack::Test::UploadedFile.new(
      StringIO.new(content), "audio/webm;codecs=opus", true,
      original_filename: "chunk-#{seq}.webm"
    )
  end

  it "청크를 seq 순서대로 이어붙여 finalize 시 webm을 만들고 변환 잡을 큐잉한다" do
    post "/api/v1/meetings/#{meeting.id}/audio_chunk", params: { chunk: chunk("AAAA", 0), sequence: 0 }
    expect(response).to have_http_status(:ok)
    post "/api/v1/meetings/#{meeting.id}/audio_chunk", params: { chunk: chunk("BBBB", 1), sequence: 1 }
    expect(response).to have_http_status(:ok)

    post "/api/v1/meetings/#{meeting.id}/audio_finalize"
    expect(response).to have_http_status(:ok)

    expect(AudioUploadJob).to have_received(:perform_later).with(meeting_id: meeting.id)

    meeting.reload
    expect(meeting.audio_file_path).to end_with(".webm")
    expect(File.exist?(meeting.audio_file_path)).to be true
    expect(File.binread(meeting.audio_file_path)).to eq("AAAABBBB")
  end

  it "청크가 늦게 도착해도 seq 기준으로 정렬해 이어붙인다" do
    post "/api/v1/meetings/#{meeting.id}/audio_chunk", params: { chunk: chunk("BBBB", 1), sequence: 1 }
    post "/api/v1/meetings/#{meeting.id}/audio_chunk", params: { chunk: chunk("AAAA", 0), sequence: 0 }
    post "/api/v1/meetings/#{meeting.id}/audio_finalize"

    meeting.reload
    expect(File.binread(meeting.audio_file_path)).to eq("AAAABBBB")
  end

  it "청크 없이 finalize하면 422" do
    post "/api/v1/meetings/#{meeting.id}/audio_finalize"
    expect(response).to have_http_status(:unprocessable_content)
    expect(AudioUploadJob).not_to have_received(:perform_later)
  end
end
