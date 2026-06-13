require "rails_helper"

# ReDiarizeJob: STT 없이 화자분리만 재실행. 핵심 = speaker_label 재할당 +
# speaker_name(비정규화 사본)을 SpeakerDB 보존 이름으로 재적용(초기화 아님).
RSpec.describe ReDiarizeJob, type: :job do
  let(:meeting) { create(:meeting, status: "transcribing", audio_file_path: "/tmp/m.mp3") }
  let(:sidecar) { instance_double(SidecarClient) }

  before do
    allow_any_instance_of(described_class).to receive(:convert_to_pcm).and_return("/tmp/m_pcm.raw")
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:delete)
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(ActionCable.server).to receive(:broadcast)
  end

  it "SpeakerDB 이름을 새 라벨에 재적용한다(유지); name==id 는 미설정→nil" do
    t1 = create(:transcript, meeting: meeting, sequence_number: 1, started_at_ms: 0,    ended_at_ms: 1000)
    t2 = create(:transcript, meeting: meeting, sequence_number: 2, started_at_ms: 1000, ended_at_ms: 2000)
    t3 = create(:transcript, meeting: meeting, sequence_number: 3, started_at_ms: 2000, ended_at_ms: 3000)

    allow(sidecar).to receive(:diarize_file).and_return({
      "segments" => [
        { "speaker_label" => "화자 1" },
        { "speaker_label" => "화자 2" },
        { "speaker_label" => "화자 1" }
      ]
    })
    # 화자 2 는 이름 미설정(name == id) → nil 로 정규화돼야 함
    allow(sidecar).to receive(:get_speakers).with(meeting.id).and_return({
      "speakers" => [
        { "id" => "화자 1", "name" => "홍춘식" },
        { "id" => "화자 2", "name" => "화자 2" }
      ]
    })

    described_class.perform_now(meeting.id)

    expect(t1.reload.speaker_label).to eq("화자 1")
    expect(t1.speaker_name).to eq("홍춘식")
    expect(t2.reload.speaker_name).to be_nil          # name==id → 미설정
    expect(t3.reload.speaker_name).to eq("홍춘식")    # 같은 라벨 → 같은 이름
    expect(meeting.reload.status).to eq("completed")
    expect(meeting.re_diarize_started_at).to be_nil
  end

  it "SpeakerDB 불통이면 speaker_name 없이도 잡은 완료된다(폴백)" do
    t1 = create(:transcript, meeting: meeting, sequence_number: 1, started_at_ms: 0, ended_at_ms: 1000)
    allow(sidecar).to receive(:diarize_file).and_return({
      "segments" => [ { "speaker_label" => "화자 1" } ]
    })
    allow(sidecar).to receive(:get_speakers).and_raise(SidecarClient::ConnectionError, "down")

    described_class.perform_now(meeting.id)

    expect(t1.reload.speaker_label).to eq("화자 1")
    expect(t1.speaker_name).to be_nil
    expect(meeting.reload.status).to eq("completed")
  end
end
