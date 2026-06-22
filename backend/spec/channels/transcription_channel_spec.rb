require "rails_helper"

RSpec.describe TranscriptionChannel, type: :channel do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user) }

  before do
    create(:project_membership, user: user, project: project, role: "admin")
    stub_connection current_user: user
  end

  describe "#subscribed" do
    context "when meeting owner" do
      it "subscribes to the meeting transcription stream" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_confirmed
        expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")
      end
    end

    context "when active participant (viewer)" do
      let(:viewer) { create(:user) }

      before do
        create(:meeting_participant, meeting: meeting, user: viewer, role: "viewer", joined_at: Time.current)
        stub_connection current_user: viewer
      end

      it "subscribes to the meeting transcription stream" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_confirmed
        expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")
      end
    end

    context "when active participant (host)" do
      let(:host_user) { create(:user) }

      before do
        create(:meeting_participant, meeting: meeting, user: host_user, role: "host", joined_at: Time.current)
        stub_connection current_user: host_user
      end

      it "subscribes to the meeting transcription stream" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_confirmed
        expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")
      end
    end

    context "when user is not owner nor active participant" do
      let(:stranger) { create(:user) }

      before { stub_connection current_user: stranger }

      it "rejects the subscription" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_rejected
      end
    end

    context "when participant has left (left_at set)" do
      let(:left_user) { create(:user) }

      before do
        create(:meeting_participant, meeting: meeting, user: left_user, role: "viewer", joined_at: 1.hour.ago, left_at: Time.current)
        stub_connection current_user: left_user
      end

      it "rejects the subscription" do
        subscribe(meeting_id: meeting.id)

        expect(subscription).to be_rejected
      end
    end

    context "when recording is already in progress by another session" do
      before do
        meeting.update!(status: "recording")
        RecordingLock.acquire(meeting.id, "other-device-token")
      end

      it "transmits recording_in_progress to the newly subscribing session" do
        subscribe(meeting_id: meeting.id)
        expect(transmissions.last).to include("type" => "recording_in_progress")
      end
    end

    context "when meeting is recording but no active recorder holds the lock" do
      before { meeting.update!(status: "recording") }

      it "does NOT transmit recording_in_progress" do
        subscribe(meeting_id: meeting.id)
        expect(transmissions.map { |t| t["type"] }).not_to include("recording_in_progress")
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
    context "when subscribed as owner and meeting is recording" do
      before do
        meeting.update!(status: "recording")
        subscribe(meeting_id: meeting.id)
      end

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

      it "claims the recording lock" do
        perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        expect(RecordingLock.holder(meeting.id)).to be_present
      end

      it "derives languages/mode from meeting.creator, ignoring client-sent values" do
        user.update!(language_mode: "multi", selected_languages: "ko,en")

        expect {
          perform(:audio_chunk, {
            "data" => "base64audio==", "sequence" => 1,
            "mode" => "single", "languages" => [ "ja" ]
          })
        }.to have_enqueued_job(TranscriptionJob).with(
          hash_including(mode: "multi", languages: %w[ko en])
        )
      end
    end

    context "when meeting is NOT in recording status" do
      before { subscribe(meeting_id: meeting.id) } # 기본 status: pending

      it "does NOT enqueue a TranscriptionJob" do
        expect {
          perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        }.not_to have_enqueued_job(TranscriptionJob)
      end
    end

    context "when subscribed as host participant and meeting is recording" do
      let(:host_user) { create(:user) }

      before do
        meeting.update!(status: "recording")
        create(:meeting_participant, meeting: meeting, user: host_user, role: "host", joined_at: Time.current)
        stub_connection current_user: host_user
        subscribe(meeting_id: meeting.id)
      end

      it "enqueues a TranscriptionJob" do
        expect {
          perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        }.to have_enqueued_job(TranscriptionJob)
      end
    end

    context "when subscribed as viewer" do
      let(:viewer) { create(:user) }

      before do
        meeting.update!(status: "recording")
        create(:meeting_participant, meeting: meeting, user: viewer, role: "viewer", joined_at: Time.current)
        stub_connection current_user: viewer
        subscribe(meeting_id: meeting.id)
      end

      it "does NOT enqueue a TranscriptionJob (audio blocked)" do
        expect {
          perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        }.not_to have_enqueued_job(TranscriptionJob)
      end
    end

    context "when another device already holds the recording lock" do
      before do
        meeting.update!(status: "recording")
        RecordingLock.acquire(meeting.id, "other-device-token")
        subscribe(meeting_id: meeting.id)
      end

      it "does NOT enqueue a TranscriptionJob (single-recorder lock)" do
        expect {
          perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        }.not_to have_enqueued_job(TranscriptionJob)
      end

      it "transmits a recording_denied notice" do
        perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        expect(transmissions.last).to include("type" => "recording_denied")
      end

      it "stays denied (demoted) even after the other holder releases" do
        perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
        RecordingLock.clear(meeting.id)
        expect {
          perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 2 })
        }.not_to have_enqueued_job(TranscriptionJob)
      end
    end
  end

  describe "#unsubscribed" do
    it "stops all streams on unsubscribe" do
      subscribe(meeting_id: meeting.id)
      expect(subscription).to have_stream_from("meeting_#{meeting.id}_transcription")

      unsubscribe
      expect(subscription).not_to have_streams
    end

    it "releases the recording lock it held" do
      meeting.update!(status: "recording")
      subscribe(meeting_id: meeting.id)
      perform(:audio_chunk, { "data" => "base64audio==", "sequence" => 1 })
      expect(RecordingLock.holder(meeting.id)).to be_present

      unsubscribe
      expect(RecordingLock.holder(meeting.id)).to be_nil
    end
  end

  describe "#heartbeat" do
    before { RecordingLock.reset! }

    it "owner 가 recording 회의에 heartbeat → recorder_heartbeat_at 갱신(액션 자체 검증)" do
      # subscribe 가 즉시 bump 하므로, subscribe 직후 시점을 캡처하고 throttle(10s)를
      # travel 로 통과시킨 뒤 heartbeat 액션이 값을 '더 최신으로' 전진시키는지 검증한다.
      # (heartbeat 부재면 be_present 만으론 subscribe bump 에 가려 액션을 검증하지 못한다.)
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: 11.seconds.ago)
      subscribe(meeting_id: meeting.id)
      after_subscribe = meeting.reload.recorder_heartbeat_at
      expect(after_subscribe).to be_present

      travel(11.seconds) do
        perform(:heartbeat)
        expect(meeting.reload.recorder_heartbeat_at).to be > after_subscribe
      end
    end

    it "10초 이내 재호출은 미갱신(throttle)" do
      ts = 3.seconds.ago
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: ts)
      subscribe(meeting_id: meeting.id)
      perform(:heartbeat)
      expect(meeting.reload.recorder_heartbeat_at).to be_within(1.second).of(ts)
    end

    it "viewer heartbeat → 미갱신" do
      viewer = create(:user)
      create(:meeting_participant, meeting: meeting, user: viewer, role: "viewer", joined_at: Time.current)
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: nil)
      stub_connection current_user: viewer
      subscribe(meeting_id: meeting.id)
      perform(:heartbeat)
      expect(meeting.reload.recorder_heartbeat_at).to be_nil
    end
  end
end
