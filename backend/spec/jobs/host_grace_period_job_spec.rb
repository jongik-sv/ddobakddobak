require "rails_helper"

RSpec.describe HostGracePeriodJob, type: :job do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }
  let(:service) { MeetingShareService.new }
  let(:disconnected_time) { Time.current }

  before do
    service.generate_share_code(meeting, user)
    # Mark host as disconnected
    host = meeting.host_participant
    host.update!(host_disconnected_at: disconnected_time)
  end

  describe "#perform" do
    context "when meeting is not found" do
      it "does nothing" do
        expect(ActionCable.server).not_to receive(:broadcast)

        described_class.perform_now(
          meeting_id: 0,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end

    context "when meeting is not sharing (share_code nil)" do
      before { meeting.update!(share_code: nil) }

      it "does nothing" do
        expect(ActionCable.server).not_to receive(:broadcast)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end

    context "when host reconnected (host_disconnected_at nil)" do
      before do
        meeting.host_participant.update!(host_disconnected_at: nil)
      end

      it "does nothing" do
        expect(ActionCable.server).not_to receive(:broadcast)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end

    context "when disconnected_at timestamp does not match" do
      it "does nothing" do
        expect(ActionCable.server).not_to receive(:broadcast)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: 1.hour.ago.iso8601(6)
        )
      end
    end

    context "when host user_id does not match the current host" do
      it "does nothing" do
        expect(ActionCable.server).not_to receive(:broadcast)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: other_user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end

    context "when no remaining viewers exist" do
      it "calls leave_meeting to clean up (triggers sharing_stopped or participant_left)" do
        leave_service = instance_double(MeetingShareService)
        allow(MeetingShareService).to receive(:new).and_return(leave_service)
        allow(leave_service).to receive(:leave_meeting)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )

        expect(leave_service).to have_received(:leave_meeting).with(meeting, user)
      end
    end

    context "when viewers exist" do
      before do
        service.join_meeting(meeting.share_code, other_user)
      end

      it "broadcasts host_claimable event" do
        # Suppress the after_update_commit broadcast from leave_meeting,
        # and capture only our explicit broadcasts
        broadcasts = []
        allow(ActionCable.server).to receive(:broadcast) do |stream, payload|
          broadcasts << { stream: stream, payload: payload }
        end

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )

        claimable = broadcasts.find { |b| b[:payload][:type] == "host_claimable" }
        expect(claimable).to be_present
        expect(claimable[:stream]).to eq(meeting.transcription_stream)
        expect(claimable[:payload][:disconnected_host_id]).to eq(user.id)
      end

      it "enqueues HostAutoPromoteJob with 20s delay" do
        allow(ActionCable.server).to receive(:broadcast)

        expect {
          described_class.perform_now(
            meeting_id: meeting.id,
            user_id: user.id,
            disconnected_at: disconnected_time.iso8601(6)
          )
        }.to have_enqueued_job(HostAutoPromoteJob).with(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end
  end
end
