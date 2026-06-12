require "rails_helper"

RSpec.describe FileTranscriptionJob, type: :job do
  let(:creator) { create(:user, language_mode: "multi", selected_languages: "ko,en") }
  let(:meeting) { create(:meeting, creator: creator, status: "transcribing") }

  let(:sidecar) { instance_double(SidecarClient) }

  before do
    allow_any_instance_of(described_class).to receive(:convert_to_pcm).and_return("/tmp/x_pcm.raw")
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:delete)
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(sidecar).to receive(:transcribe_file).and_return({ "segments" => [] })
    allow(sidecar).to receive(:get_speakers).and_return({ "speakers" => [] })
    allow_any_instance_of(described_class).to receive(:generate_summary)
    allow(MeetingFinalizerService).to receive(:new).and_return(instance_double(MeetingFinalizerService, call: nil))
  end

  it "passes the meeting creator's language config to the sidecar, not ENV" do
    ENV["SELECTED_LANGUAGES"] = "ja"
    ENV["LANGUAGE_MODE"] = "single"

    expect(sidecar).to receive(:transcribe_file).with(
      anything,
      hash_including(languages: %w[ko en], mode: "multi")
    ).and_return({ "segments" => [] })

    described_class.perform_now(meeting.id)
  ensure
    ENV.delete("SELECTED_LANGUAGES")
    ENV.delete("LANGUAGE_MODE")
  end

  it "재생성 후 SpeakerDB 이름(name != id)만 speaker_name으로 재적용한다" do
    allow(sidecar).to receive(:transcribe_file).and_return({
      "segments" => [
        { "text" => "안녕하세요", "speaker_label" => "화자 1", "started_at_ms" => 0, "ended_at_ms" => 1000 },
        { "text" => "반갑습니다", "speaker_label" => "화자 2", "started_at_ms" => 1000, "ended_at_ms" => 2000 }
      ]
    })
    allow(sidecar).to receive(:get_speakers).with(meeting.id).and_return({
      "speakers" => [
        { "id" => "화자 1", "name" => "앨리스" },
        { "id" => "화자 2", "name" => "화자 2" }
      ]
    })

    described_class.perform_now(meeting.id)

    expect(meeting.transcripts.find_by(speaker_label: "화자 1").speaker_name).to eq("앨리스")
    expect(meeting.transcripts.find_by(speaker_label: "화자 2").speaker_name).to be_nil
  end

  it "get_speakers 실패 시에도 잡은 정상 완료한다 (이름 미적용)" do
    allow(sidecar).to receive(:transcribe_file).and_return({
      "segments" => [
        { "text" => "안녕하세요", "speaker_label" => "화자 1", "started_at_ms" => 0, "ended_at_ms" => 1000 }
      ]
    })
    allow(sidecar).to receive(:get_speakers)
      .and_raise(SidecarClient::ConnectionError, "down")

    described_class.perform_now(meeting.id)

    expect(meeting.reload.status).to eq("completed")
    expect(meeting.transcripts.first.speaker_name).to be_nil
  end
end
