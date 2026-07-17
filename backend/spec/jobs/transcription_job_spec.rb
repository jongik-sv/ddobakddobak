require "rails_helper"
require "tmpdir"
require "fileutils"

RSpec.describe TranscriptionJob, type: :job do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user) }
  let(:sidecar_client) { instance_double(SidecarClient) }

  before do
    allow(SidecarClient).to receive(:new).and_return(sidecar_client)
  end

  let(:segments) do
    [
      {
        "type" => "final",
        "text" => "Hello world",
        "speaker" => "SPEAKER_01",
        "started_at_ms" => 0,
        "ended_at_ms" => 3000,
        "seq" => 1
      }
    ]
  end

  before do
    allow(sidecar_client).to receive(:transcribe).and_return({ "segments" => segments })
  end

  describe "#perform" do
    it "calls SidecarClient#transcribe with the audio data" do
      expect(sidecar_client).to receive(:transcribe).with(
        "base64audio==",
        hash_including(meeting_id: meeting.id)
      )

      described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
    end

    it "saves transcript records to the database" do
      expect {
        described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
      }.to change(Transcript, :count).by(1)

      transcript = Transcript.last
      expect(transcript.content).to eq("Hello world")
      expect(transcript.speaker_label).to eq("SPEAKER_01")
      expect(transcript.started_at_ms).to eq(0)
      expect(transcript.ended_at_ms).to eq(3000)
      expect(transcript.sequence_number).to eq(1)
      expect(transcript.meeting).to eq(meeting)
    end

    it "broadcasts to the meeting transcription stream" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(
          type: "final",
          text: "Hello world",
          speaker: "SPEAKER_01",
          started_at_ms: 0,
          ended_at_ms: 3000,
          seq: 1
        )
      )

      described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
    end

    context "with multiple segments" do
      let(:segments) do
        [
          { "type" => "final", "text" => "First sentence", "speaker" => "SPEAKER_00",
            "started_at_ms" => 0, "ended_at_ms" => 1500, "seq" => 1 },
          { "type" => "final", "text" => "Second sentence", "speaker" => "SPEAKER_01",
            "started_at_ms" => 1500, "ended_at_ms" => 3000, "seq" => 2 }
        ]
      end

      it "saves all transcript records" do
        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
        }.to change(Transcript, :count).by(2)
      end

      it "broadcasts for each segment" do
        expect(ActionCable.server).to receive(:broadcast).twice

        described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
      end
    end

    context "when sidecar returns empty segments" do
      before do
        allow(sidecar_client).to receive(:transcribe).and_return({ "segments" => [] })
      end

      it "does not create any transcripts" do
        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
        }.not_to change(Transcript, :count)
      end
    end

    context "when SidecarClient raises SidecarError" do
      before do
        allow(sidecar_client).to receive(:transcribe).and_raise(SidecarClient::SidecarError, "Sidecar error 500")
      end

      it "does not raise and logs the error" do
        expect(Rails.logger).to receive(:error).with(/Sidecar error/)

        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
        }.not_to raise_error
      end

      it "does not create any transcripts" do
        allow(Rails.logger).to receive(:error)

        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 1)
        }.not_to change(Transcript, :count)
      end
    end

    context "when segment is missing optional fields" do
      let(:segments) do
        [ { "text" => "Minimal segment" } ]
      end

      it "uses default values for missing fields" do
        described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 5)

        transcript = Transcript.last
        expect(transcript.speaker_label).to eq("화자 1")
        expect(transcript.started_at_ms).to eq(0)
        expect(transcript.ended_at_ms).to eq(0)
        expect(transcript.sequence_number).to eq(5)
      end
    end

    context "with audio_path (신형, 디스크 경로 경유)" do
      let(:audio_dir) { Dir.mktmpdir("transcription_job_spec") }
      let(:audio_path) { File.join(audio_dir, "3-abc.pcm") }

      before { File.binwrite(audio_path, "raw-pcm-bytes") }
      after { FileUtils.rm_rf(audio_dir) }

      it "reads the file and passes its base64 encoding to SidecarClient#transcribe" do
        expect(sidecar_client).to receive(:transcribe).with(
          Base64.strict_encode64("raw-pcm-bytes"),
          hash_including(meeting_id: meeting.id)
        )

        described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
      end

      it "deletes the chunk file after a successful run" do
        described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)

        expect(File).not_to exist(audio_path)
      end

      context "when audio_path does not exist (ENOENT)" do
        before { File.delete(audio_path) }

        it "logs a warning and returns without raising" do
          expect(Rails.logger).to receive(:warn).with(/청크 파일 유실/)

          expect {
            described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
          }.not_to raise_error
        end

        it "does not call SidecarClient#transcribe" do
          allow(Rails.logger).to receive(:warn)
          expect(sidecar_client).not_to receive(:transcribe)

          described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
        end
      end

      context "when SidecarClient raises a retryable error (TimeoutError/ConnectionError)" do
        before do
          allow(sidecar_client).to receive(:transcribe).and_raise(SidecarClient::TimeoutError, "timed out")
        end

        it "propagates the exception instead of swallowing it (so retry_on can catch it)" do
          expect {
            described_class.new.perform(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
          }.to raise_error(SidecarClient::TimeoutError)
        end

        it "preserves the chunk file (does not delete it)" do
          begin
            described_class.new.perform(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
          rescue SidecarClient::TimeoutError
            # 예상된 전파 — 파일 보존 여부만 확인
          end

          expect(File).to exist(audio_path)
        end
      end

      context "when SidecarClient raises a non-retryable SidecarError" do
        before do
          allow(sidecar_client).to receive(:transcribe).and_raise(SidecarClient::SidecarError, "Sidecar error 500")
        end

        it "logs the error and deletes the chunk file (drop confirmed)" do
          expect(Rails.logger).to receive(:error).with(/Sidecar error/)

          described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)

          expect(File).not_to exist(audio_path)
        end
      end
    end

    context "when neither audio_data nor audio_path is present" do
      it "logs a warning, creates no transcripts, and does not raise" do
        expect(Rails.logger).to receive(:warn).with(/audio_data\/audio_path/)

        expect {
          described_class.perform_now(meeting_id: meeting.id, sequence: 1)
        }.not_to change(Transcript, :count)
      end
    end

    context "when the meeting no longer exists (deleted before the job runs)" do
      it "discards the job instead of raising or retrying" do
        deleted_id = meeting.id
        meeting.destroy!

        expect {
          described_class.perform_now(meeting_id: deleted_id, audio_data: "base64audio==", sequence: 1)
        }.not_to raise_error
      end
    end
  end
end
