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

    # ⭐ A7. 기밀 구간 절단(transcripts#redact)이 적용된 회의는 표식(transcripts_redacted_at)으로
    # 잠긴다. 그런데 그 표식을 보는 곳은 컨트롤러 4곳(transcripts#bulk_create,
    # meetings_audio#create/#chunk/#finalize)과 AudioUploadJob 뿐이라, ActionCable 실시간 경로
    # (TranscriptionChannel#audio_chunk → 이 잡)는 그 가드를 **전부 우회해** 전사를 직접 쓴다.
    # 파기한 기밀이 그대로 되살아나는 경로이므로 이 잡 자체가 표식을 봐야 한다.
    context "when the meeting has been redacted (절단 표식)" do
      let(:audio_dir) { Dir.mktmpdir("transcription_job_redacted_spec") }
      let(:audio_path) { File.join(audio_dir, "9-abc.pcm") }

      before do
        File.binwrite(audio_path, "raw-pcm-bytes")
        meeting.update!(transcripts_redacted_at: Time.current)
      end

      after { FileUtils.rm_rf(audio_dir) }

      it "전사 행을 만들지 않는다 (파기한 기밀이 되살아나는 경로)" do
        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
        }.not_to change(Transcript, :count)
      end

      it "sidecar 를 아예 호출하지 않고 청크 파일도 남기지 않는다" do
        # 청크 = 절단된 회의의 원시 PCM. 조기 종료하면서 파일을 남기면 6시간 스위퍼까지
        # 기밀 오디오가 디스크에 그대로 있다.
        expect(sidecar_client).not_to receive(:transcribe)

        described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)

        expect(File).not_to exist(audio_path)
      end

      it "채널로 사유를 알린다 (클라이언트가 계속 밀어올리지 않도록)" do
        expect(ActionCable.server).to receive(:broadcast).with(
          meeting.transcription_stream,
          hash_including(type: "transcription_rejected", code: MeetingWriteGuard::REDACTED_ERROR_CODE)
        )

        described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
      end

      it "잡이 도는 **도중에** 절단이 커밋돼도 전사를 쓰지 않는다" do
        # 표식을 잡 시작 시 한 번만 읽으면 sidecar 왕복(수 초) 동안 커밋된 절단을 못 본다.
        # 그 창으로 들어온 세그먼트는 절단 직후의 회의에 기밀 텍스트를 그대로 쓴다.
        meeting.update!(transcripts_redacted_at: nil)
        allow(sidecar_client).to receive(:transcribe) do
          Meeting.where(id: meeting.id).update_all(transcripts_redacted_at: Time.current)
          { "segments" => segments }
        end

        expect {
          described_class.perform_now(meeting_id: meeting.id, audio_path: audio_path, sequence: 1)
        }.not_to change(Transcript, :count)
        expect(File).not_to exist(audio_path)
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
