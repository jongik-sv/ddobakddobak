require "rails_helper"

RSpec.describe HostAutoPromoteJob, type: :job do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:third_user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }
  let(:service) { MeetingShareService.new }
  let(:disconnected_time) { Time.current }

  before do
    service.generate_share_code(meeting, user)
    service.join_meeting(meeting.share_code, other_user)
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

    context "when meeting is not sharing" do
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

    context "when someone already claimed host (different user is host)" do
      before do
        # Simulate someone claimed host: old host left, other_user is now host
        meeting.host_participant.update!(left_at: Time.current)
        meeting.active_participants.find_by(user: other_user).update!(role: MeetingParticipant::ROLE_HOST)
      end

      it "does nothing because current host is a different user" do
        expect_any_instance_of(MeetingShareService).not_to receive(:leave_meeting)

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
        expect_any_instance_of(MeetingShareService).not_to receive(:leave_meeting)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )
      end
    end

    context "when disconnected_at timestamp does not match" do
      it "does nothing" do
        expect_any_instance_of(MeetingShareService).not_to receive(:leave_meeting)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: 1.hour.ago.iso8601(6)
        )
      end
    end

    context "when host is still disconnected and no one claimed" do
      it "auto-promotes earliest joined viewer via leave_meeting" do
        allow(ActionCable.server).to receive(:broadcast)

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )

        # The old host should have left_at set
        old_host = meeting.meeting_participants.find_by(user: user, role: MeetingParticipant::ROLE_HOST)
        expect(old_host.left_at).to be_present

        # other_user (earliest viewer) should now be host
        new_host = meeting.active_participants.reload.find_by(role: MeetingParticipant::ROLE_HOST)
        expect(new_host.user).to eq(other_user)
      end

      it "broadcasts host_transferred with the new host" do
        broadcasts = []
        allow(ActionCable.server).to receive(:broadcast) do |stream, payload|
          broadcasts << { stream: stream, payload: payload }
        end

        described_class.perform_now(
          meeting_id: meeting.id,
          user_id: user.id,
          disconnected_at: disconnected_time.iso8601(6)
        )

        host_transferred = broadcasts.find { |b| b[:payload][:type] == "host_transferred" }
        expect(host_transferred).to be_present
        expect(host_transferred[:stream]).to eq(meeting.transcription_stream)
        expect(host_transferred[:payload][:new_host_id]).to eq(other_user.id)
        expect(host_transferred[:payload][:new_host_name]).to eq(other_user.name)
      end

      context "with multiple viewers" do
        before do
          service.join_meeting(meeting.share_code, third_user)
        end

        it "promotes the earliest joined viewer" do
          allow(ActionCable.server).to receive(:broadcast)

          described_class.perform_now(
            meeting_id: meeting.id,
            user_id: user.id,
            disconnected_at: disconnected_time.iso8601(6)
          )

          # other_user joined before third_user, so should become host
          new_host = meeting.active_participants.reload.find_by(role: MeetingParticipant::ROLE_HOST)
          expect(new_host.user).to eq(other_user)
        end
      end
    end
  end
end
