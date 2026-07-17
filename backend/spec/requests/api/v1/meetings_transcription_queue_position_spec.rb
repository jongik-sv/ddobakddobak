require "rails_helper"

# meeting_json 직렬화에 transcription_queue_position 이 실려나가는지 배선만 확인.
# 계산 로직 자체(대기 잡 카운트/claimed 판정)는 spec/models/meeting_transcription_queue_position_spec.rb 담당.
RSpec.describe "Api::V1::Meetings transcription_queue_position", type: :request do
  let(:user) { create(:user) }

  before { login_as(user) }

  it "transcribing 이 아니면 nil" do
    meeting = create(:meeting, creator: user, status: "completed")

    get "/api/v1/meetings/#{meeting.id}"

    body = JSON.parse(response.body)
    expect(body["meeting"]).to have_key("transcription_queue_position")
    expect(body["meeting"]["transcription_queue_position"]).to be_nil
  end

  it "transcribing 이고 대기열에 앞선 잡이 있으면 그 수를 실어보낸다" do
    meeting = create(:meeting, creator: user, status: "transcribing")
    fake_job = double("SolidQueue::Job", id: 1, class_name: "FileTranscriptionJob",
                       arguments: { "arguments" => [ meeting.id ] }, claimed?: false)
    ahead = double("SolidQueue::Job", id: 0, class_name: "FileTranscriptionJob",
                    arguments: { "arguments" => [ meeting.id + 1 ] }, claimed?: false)
    allow(Meeting).to receive(:unfinished_transcription_queue_jobs).and_return([ ahead, fake_job ])

    get "/api/v1/meetings/#{meeting.id}"

    body = JSON.parse(response.body)
    expect(body["meeting"]["transcription_queue_position"]).to eq(1)
  end
end
