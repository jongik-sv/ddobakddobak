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
    allow(sidecar).to receive(:get_transcribe_progress).and_return(nil)
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

  describe "STT 폴링 진행률" do
    let(:job) { described_class.new }

    it "processed/total 을 5~90% 로 선형 매핑한다" do
      expect(job.send(:stt_poll_percent, 0, 1000)).to eq(5)
      expect(job.send(:stt_poll_percent, 1000, 1000)).to eq(90)
      expect(job.send(:stt_poll_percent, 500, 1000)).to eq(48) # 5 + 0.5*85 = 47.5 → 48
      expect(job.send(:stt_poll_percent, 100, 0)).to eq(5)     # total 0 → 최소
    end

    it "경과 시간을 표기한다 (10% 미만이면 잔여 없음)" do
      # pct = 5 + 1000/100000*85 ≈ 6 (<10) → 잔여 미표기
      msg = job.send(:stt_poll_message, 6, 90, 1000, 100000)
      expect(msg).to eq("음성 인식 중… 경과 1:30")
    end

    it "10% 이상이면 경과 + 잔여(추정)를 표기한다" do
      # elapsed 60s, processed 50%/total → 잔여 = 60*(1-0.5)/0.5 = 60s, pct=48(≥10)
      msg = job.send(:stt_poll_message, 48, 60, 5000, 10000)
      expect(msg).to eq("음성 인식 중… 경과 1:00 · 잔여 ~1:00")
    end

    it "format_hms: 1시간 이상은 H:MM:SS, 음수는 0:00" do
      expect(job.send(:format_hms, 90)).to eq("1:30")
      expect(job.send(:format_hms, 3661)).to eq("1:01:01")
      expect(job.send(:format_hms, -5)).to eq("0:00")
    end

    it "전사 중 진행률을 broadcast 한다" do
      allow(sidecar).to receive(:get_transcribe_progress).with(meeting.id)
        .and_return({ "processed_ms" => 5000, "total_ms" => 10000 })
      allow(sidecar).to receive(:transcribe_file) { sleep 0.1; { "segments" => [] } }

      broadcasts = []
      allow(ActionCable.server).to receive(:broadcast) { |_ch, msg| broadcasts << msg }

      described_class.perform_now(meeting.id)

      prog = broadcasts.select { |m| m[:type] == "transcription_progress" && m[:message].to_s.include?("음성 인식 중") }
      expect(prog).not_to be_empty
      expect(prog.first[:progress]).to eq(48)
    end

    it "phase=post(화자분리·후처리) 중엔 90%로 안내한다" do
      allow(sidecar).to receive(:get_transcribe_progress).with(meeting.id)
        .and_return({ "phase" => "post", "processed_ms" => 10000, "total_ms" => 10000 })
      allow(sidecar).to receive(:transcribe_file) { sleep 0.1; { "segments" => [] } }

      broadcasts = []
      allow(ActionCable.server).to receive(:broadcast) { |_ch, msg| broadcasts << msg }

      described_class.perform_now(meeting.id)

      post = broadcasts.select { |m| m[:type] == "transcription_progress" && m[:message].to_s.include?("화자 분리") }
      expect(post).not_to be_empty
      expect(post.first[:progress]).to eq(90)
    end
  end

  describe "EmbedBackfillJob enqueue (reconcile_embeddings!)" do
    include ActiveJob::TestHelper

    it "perform 완료 후 EmbedBackfillJob이 meeting_id로 enqueue된다" do
      expect {
        described_class.perform_now(meeting.id)
      }.to have_enqueued_job(EmbedBackfillJob).with(meeting_id: meeting.id)
    end
  end

  context "화자분리 ON" do
    before do
      allow(AppSettings).to receive(:diarization_config).and_return({ "enable" => true, "clustering_threshold" => 0.6 })
    end

    it "회의록 자동생성과 finalizer를 스킵하고 completed로 만든다" do
      # 상단 before의 generate_summary allow 스텁을 부정 기대로 대체해 실제 분기를 검증
      expect_any_instance_of(described_class).not_to receive(:generate_summary)
      expect(MeetingFinalizerService).not_to receive(:new)
      described_class.perform_now(meeting.id)
      expect(meeting.reload.status).to eq("completed")
    end

    it "expected_participants가 있으면 diarization_config에 expected_speakers로 넣어 보낸다" do
      meeting.update!(expected_participants: 5)
      expect(sidecar).to receive(:transcribe_file)
        .with(anything, hash_including(diarization_config: hash_including("expected_speakers" => 5, "enable" => true)))
        .and_return({ "segments" => [] })
      described_class.perform_now(meeting.id)
    end
  end
end
