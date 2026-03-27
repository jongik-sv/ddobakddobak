require "rails_helper"

RSpec.describe TranscriptionJob, type: :job do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }
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
        [{ "text" => "Minimal segment" }]
      end

      it "uses default values for missing fields" do
        described_class.perform_now(meeting_id: meeting.id, audio_data: "base64audio==", sequence: 5)

        transcript = Transcript.last
        expect(transcript.speaker_label).to eq("SPEAKER_00")
        expect(transcript.started_at_ms).to eq(0)
        expect(transcript.ended_at_ms).to eq(0)
        expect(transcript.sequence_number).to eq(5)
      end
    end
  end
end
