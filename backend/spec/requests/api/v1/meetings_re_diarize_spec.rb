require "rails_helper"

# 화자분리 재실행(re_diarize): STT 없이 화자분리만 다시 돌린다.
# - completed + 트랜스크립트 + 오디오 파일 존재 → 200, status=transcribing, ReDiarizeJob enqueue
# - 트랜스크립트 없음 → 422
RSpec.describe "Api::V1::Meetings re_diarize", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, status: "completed", audio_file_path: "/tmp/meeting_audio.mp3") }

  before { login_as(user) }

  context "completed 회의 + 트랜스크립트 + 오디오 파일 존재" do
    before do
      create(:transcript, meeting: meeting, sequence_number: 1)
      # 오디오 파일 존재 스텁 (실제 파일 없이도 통과)
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(meeting.audio_file_path).and_return(true)
    end

    it "200 + status transcribing + ReDiarizeJob enqueue" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/re_diarize"
      }.to have_enqueued_job(ReDiarizeJob).with(meeting.id)

      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("transcribing")
      expect(response.parsed_body["meeting"]["id"]).to eq(meeting.id)
    end
  end

  context "트랜스크립트가 없는 회의" do
    before do
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(meeting.audio_file_path).and_return(true)
    end

    it "422" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/re_diarize"
      }.not_to have_enqueued_job(ReDiarizeJob)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(meeting.reload.status).to eq("completed")
    end
  end
end
