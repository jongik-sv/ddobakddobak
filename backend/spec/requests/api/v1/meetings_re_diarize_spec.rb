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

  # 멈춘 화자분리-재실행 자가복구: :async 잡 드롭으로 transcribing 에 정지된 회의가
  # stale(re_diarize_started_at 가 오래됨) 이면 조회/재실행 시 completed 로 회복된다.
  context "stale 화자분리 재실행으로 멈춘 회의 (transcribing + 오래된 re_diarize_started_at)" do
    before do
      create(:transcript, meeting: meeting, sequence_number: 1)
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(meeting.audio_file_path).and_return(true)
      meeting.update_columns(status: "transcribing", re_diarize_started_at: 10.minutes.ago)
    end

    it "GET show 가 completed 로 자가복구한다" do
      get "/api/v1/meetings/#{meeting.id}"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("completed")
      expect(meeting.re_diarize_started_at).to be_nil
    end

    it "POST re_diarize 가 회복 후 재실행한다(200 + enqueue)" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/re_diarize"
      }.to have_enqueued_job(ReDiarizeJob).with(meeting.id)
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("transcribing")
    end
  end

  context "정상 진행 중인 화자분리 (transcribing + 최근 re_diarize_started_at)" do
    before do
      create(:transcript, meeting: meeting, sequence_number: 1)
      meeting.update_columns(status: "transcribing", re_diarize_started_at: 30.seconds.ago)
    end

    it "stale 아니므로 회복 안 함 → 422 (이중 실행 방지)" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/re_diarize"
      }.not_to have_enqueued_job(ReDiarizeJob)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(meeting.reload.status).to eq("transcribing")
    end
  end

  context "실 STT 진행 중 (transcribing + re_diarize_started_at nil)" do
    before { meeting.update_columns(status: "transcribing", re_diarize_started_at: nil) }

    it "GET show 가 절대 건드리지 않는다(클로버 방지)" do
      get "/api/v1/meetings/#{meeting.id}"
      expect(response).to have_http_status(:ok)
      expect(meeting.reload.status).to eq("transcribing")
    end
  end
end
