require "rails_helper"

RSpec.describe MeetingShareService do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }
  let(:service) { described_class.new }

  # ============================================================
  # #generate_share_code
  # ============================================================
  describe "#generate_share_code" do
    it "generates a 6-character alphanumeric share code" do
      result = service.generate_share_code(meeting, user)

      expect(result[:share_code]).to match(/\A[A-Z0-9]{6}\z/)
    end

    it "saves the share code to the meeting" do
      service.generate_share_code(meeting, user)

      expect(meeting.reload.share_code).to match(/\A[A-Z0-9]{6}\z/)
    end

    it "registers the caller as host participant" do
      service.generate_share_code(meeting, user)

      participant = meeting.meeting_participants.find_by(user: user)
      expect(participant).to be_present
      expect(participant.role).to eq("host")
      expect(participant.joined_at).to be_present
      expect(participant.left_at).to be_nil
    end

    it "returns existing share code if already sharing (idempotent)" do
      first_result = service.generate_share_code(meeting, user)
      second_result = service.generate_share_code(meeting, user)

      expect(second_result[:share_code]).to eq(first_result[:share_code])
    end

    it "does not create duplicate host participant on repeated call" do
      service.generate_share_code(meeting, user)
      service.generate_share_code(meeting, user)

      expect(meeting.meeting_participants.where(user: user).active.count).to eq(1)
    end
  end

  # ============================================================
  # #revoke_share_code
  # ============================================================
  describe "#revoke_share_code" do
    before do
      service.generate_share_code(meeting, user)
      service.join_meeting(meeting.share_code, other_user)
    end

    it "sets share_code to nil" do
      service.revoke_share_code(meeting, user)

      expect(meeting.reload.share_code).to be_nil
    end

    it "sets left_at for all active participants" do
      service.revoke_share_code(meeting, user)

      meeting.meeting_participants.reload.each do |p|
        expect(p.left_at).to be_present
      end
    end

    it "raises error if user is not the host" do
      expect {
        service.revoke_share_code(meeting, other_user)
      }.to raise_error(MeetingShareService::NotHostError)
    end
  end

  # ============================================================
  # #join_meeting
  # ============================================================
  describe "#join_meeting" do
    before { service.generate_share_code(meeting, user) }

    it "creates a viewer participant for the joining user" do
      result = service.join_meeting(meeting.share_code, other_user)

      expect(result[:participant].role).to eq("viewer")
      expect(result[:participant].user).to eq(other_user)
    end

    it "returns the meeting in the result" do
      result = service.join_meeting(meeting.share_code, other_user)

      expect(result[:meeting]).to eq(meeting)
    end

    it "returns existing participation if already joined (idempotent)" do
      first_result = service.join_meeting(meeting.share_code, other_user)
      second_result = service.join_meeting(meeting.share_code, other_user)

      expect(second_result[:participant].id).to eq(first_result[:participant].id)
    end

    it "raises error for invalid share code" do
      expect {
        service.join_meeting("XXXXXX", other_user)
      }.to raise_error(MeetingShareService::InvalidShareCodeError)
    end

    it "raises error when participant limit (20) is reached" do
      # Create 19 viewers (+ 1 host = 20 total)
      19.times do
        u = create(:user)
        service.join_meeting(meeting.share_code, u)
      end

      new_user = create(:user)
      expect {
        service.join_meeting(meeting.share_code, new_user)
      }.to raise_error(MeetingShareService::ParticipantLimitError)
    end
  end

  # ============================================================
  # #transfer_host
  # ============================================================
  describe "#transfer_host" do
    before do
      service.generate_share_code(meeting, user)
      service.join_meeting(meeting.share_code, other_user)
    end

    it "changes current host to viewer" do
      service.transfer_host(meeting, user, other_user.id)

      host_participant = meeting.meeting_participants.active.find_by(user: user)
      expect(host_participant.role).to eq("viewer")
    end

    it "promotes target user to host" do
      service.transfer_host(meeting, user, other_user.id)

      target_participant = meeting.meeting_participants.active.find_by(user: other_user)
      expect(target_participant.role).to eq("host")
    end

    it "raises error if caller is not the current host" do
      expect {
        service.transfer_host(meeting, other_user, user.id)
      }.to raise_error(MeetingShareService::NotHostError)
    end

    it "raises error if target is not an active participant" do
      non_participant = create(:user)

      expect {
        service.transfer_host(meeting, user, non_participant.id)
      }.to raise_error(MeetingShareService::InvalidTargetError)
    end

    it "broadcasts host_transferred event with new host info" do
      target_user = other_user

      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_transcription",
        hash_including(
          type: "host_transferred",
          new_host_id: target_user.id,
          new_host_name: target_user.name
        )
      )

      service.transfer_host(meeting, user, target_user.id)
    end
  end

  # ============================================================
  # #leave_meeting
  # ============================================================
  describe "#leave_meeting" do
    before do
      service.generate_share_code(meeting, user)
      service.join_meeting(meeting.share_code, other_user)
    end

    it "sets left_at for the leaving user" do
      service.leave_meeting(meeting, other_user)

      participant = meeting.meeting_participants.find_by(user: other_user)
      expect(participant.left_at).to be_present
    end

    it "auto-delegates host to earliest joined viewer when host leaves" do
      third_user = create(:user)
      service.join_meeting(meeting.share_code, third_user)

      service.leave_meeting(meeting, user)

      # other_user joined before third_user, so should become host
      new_host = meeting.meeting_participants.active.host.first
      expect(new_host.user).to eq(other_user)
    end

    it "sets left_at for host when host leaves and viewers exist" do
      service.leave_meeting(meeting, user)

      host_record = meeting.meeting_participants.find_by(user: user, role: "host")
      # host was changed to viewer then left, or left directly
      participant = meeting.meeting_participants.where(user: user).order(:id).last
      expect(participant.left_at).to be_present
    end

    it "clears share_code when last participant leaves" do
      service.leave_meeting(meeting, other_user)
      service.leave_meeting(meeting, user)

      expect(meeting.reload.share_code).to be_nil
    end

    it "broadcasts host_transferred when host leaves and auto-delegates" do
      third_user = create(:user)
      service.join_meeting(meeting.share_code, third_user)

      broadcasts = []
      allow(ActionCable.server).to receive(:broadcast) do |stream, payload|
        broadcasts << { stream: stream, payload: payload }
      end

      service.leave_meeting(meeting, user)

      host_transferred = broadcasts.find { |b| b[:payload][:type] == "host_transferred" }
      expect(host_transferred).to be_present
      expect(host_transferred[:stream]).to eq("meeting_#{meeting.id}_transcription")
      expect(host_transferred[:payload][:new_host_id]).to eq(other_user.id)
      expect(host_transferred[:payload][:new_host_name]).to eq(other_user.name)
    end
  end

  # ============================================================
  # #claim_host
  # ============================================================
  describe "#claim_host" do
    let(:disconnected_time) { Time.current }

    before do
      service.generate_share_code(meeting, user)
      service.join_meeting(meeting.share_code, other_user)
    end

    context "when host is disconnected" do
      before do
        meeting.host_participant.update!(host_disconnected_at: disconnected_time)
      end

      it "promotes the viewer to host" do
        allow(ActionCable.server).to receive(:broadcast)

        service.claim_host(meeting, other_user)

        new_host = meeting.active_participants.reload.find_by(role: "host")
        expect(new_host.user).to eq(other_user)
      end

      it "marks old disconnected host as left (left_at set)" do
        allow(ActionCable.server).to receive(:broadcast)

        service.claim_host(meeting, other_user)

        old_host = meeting.meeting_participants.find_by(user: user, role: "host")
        expect(old_host.left_at).to be_present
      end

      it "broadcasts host_transferred with the new host info" do
        broadcasts = []
        allow(ActionCable.server).to receive(:broadcast) do |stream, payload|
          broadcasts << { stream: stream, payload: payload }
        end

        service.claim_host(meeting, other_user)

        host_transferred = broadcasts.find { |b| b[:payload][:type] == "host_transferred" }
        expect(host_transferred).to be_present
        expect(host_transferred[:payload][:new_host_id]).to eq(other_user.id)
        expect(host_transferred[:payload][:new_host_name]).to eq(other_user.name)
      end
    end

    context "when host is still connected (host_disconnected_at nil)" do
      it "raises NotHostError" do
        expect {
          service.claim_host(meeting, other_user)
        }.to raise_error(MeetingShareService::NotHostError)
      end
    end

    context "when claimer is not an active viewer" do
      before do
        meeting.host_participant.update!(host_disconnected_at: disconnected_time)
      end

      it "raises InvalidTargetError for non-participant user" do
        non_participant = create(:user)

        expect {
          service.claim_host(meeting, non_participant)
        }.to raise_error(MeetingShareService::InvalidTargetError)
      end

      it "raises InvalidTargetError if claimer is the host (not a viewer)" do
        expect {
          service.claim_host(meeting, user)
        }.to raise_error(MeetingShareService::InvalidTargetError)
      end
    end
  end

  # ============================================================
  # #join_meeting — host auto-promotion
  # ============================================================
  describe "#join_meeting host auto-promotion" do
    before { service.generate_share_code(meeting, user) }

    context "when no active host exists" do
      before do
        # Host leaves so there is no active host
        meeting.host_participant.update!(left_at: Time.current)
      end

      it "auto-promotes the joining user to host" do
        allow(ActionCable.server).to receive(:broadcast)

        result = service.join_meeting(meeting.share_code, other_user)

        expect(result[:participant].role).to eq("host")
      end

      it "broadcasts host_transferred for the auto-promoted host" do
        broadcasts = []
        allow(ActionCable.server).to receive(:broadcast) do |stream, payload|
          broadcasts << { stream: stream, payload: payload }
        end

        service.join_meeting(meeting.share_code, other_user)

        host_transferred = broadcasts.find { |b| b[:payload][:type] == "host_transferred" }
        expect(host_transferred).to be_present
        expect(host_transferred[:payload][:new_host_id]).to eq(other_user.id)
      end
    end

    context "when active host exists" do
      it "does NOT promote the joining user (stays viewer)" do
        result = service.join_meeting(meeting.share_code, other_user)

        expect(result[:participant].role).to eq("viewer")
      end
    end
  end
end
