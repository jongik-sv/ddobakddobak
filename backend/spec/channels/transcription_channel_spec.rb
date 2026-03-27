require "rails_helper"

RSpec.describe TranscriptionChannel, type: :channel do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }

  before do
    create(:team_membership, user: user, team: team, role: "admin")
    stub_connection current_user: user
  end

  describe "#subscribed" do
    context "with a valid meeting_id" do
      it "subscribes to the meeting transcription stream" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_confirmed
        expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")
      end
    end

    context "with an invalid meeting_id" do
      it "rejects the subscription" do
        subscribe(meeting_id: 99999)

        expect(subscription).to be_rejected
      end
    end

    context "without meeting_id" do
      it "rejects the subscription" do
        subscribe(meeting_id: nil)

        expect(subscription).to be_rejected
      end
    end
  end

  describe "#audio_chunk" do
    before { subscribe(meeting_id: meeting.id) }

    it "enqueues a TranscriptionJob with the correct arguments" do
      expect {
        perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 3 })
      }.to have_enqueued_job(TranscriptionJob).with(
        hash_including(
          meeting_id: meeting.id,
          audio_data: "base64audio==",
          sequence: 3
        )
      )
    end

    it "handles missing sequence by defaulting to 0" do
      expect {
        perform(:audio_chunk, { "data" => "base64audio==" })
      }.to have_enqueued_job(TranscriptionJob).with(
        hash_including(
          meeting_id: meeting.id,
          audio_data: "base64audio==",
          sequence: 0
        )
      )
    end
  end

  describe "#unsubscribed" do
    it "stops all streams on unsubscribe" do
      subscribe(meeting_id: meeting.id)
      expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")

      unsubscribe
      expect(subscription).not_to have_streams
    end
  end
end
