require "rails_helper"

RSpec.describe MeetingParticipant, type: :model do
  let(:user) { create(:user) }
  let(:team) { create(:team, creator: user) }
  let(:meeting) { create(:meeting, team: team, creator: user) }

  # ============================================================
  # Associations
  # ============================================================
  describe "associations" do
    it { is_expected.to belong_to(:meeting) }
    it { is_expected.to belong_to(:user) }
  end

  # ============================================================
  # Validations
  # ============================================================
  describe "validations" do
    it { is_expected.to validate_inclusion_of(:role).in_array(%w[host viewer]) }

    it "validates uniqueness of user_id scoped to meeting_id for active participants" do
      create(:meeting_participant, meeting: meeting, user: user, role: "host", joined_at: Time.current)

      duplicate = build(:meeting_participant, meeting: meeting, user: user, role: "viewer", joined_at: Time.current)
      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:user_id]).to be_present
    end

    it "allows same user to rejoin after leaving" do
      create(:meeting_participant, meeting: meeting, user: user, role: "host", joined_at: 1.hour.ago, left_at: Time.current)

      rejoin = build(:meeting_participant, meeting: meeting, user: user, role: "viewer", joined_at: Time.current)
      expect(rejoin).to be_valid
    end
  end

  # ============================================================
  # Scopes
  # ============================================================
  describe "scopes" do
    let(:other_user) { create(:user) }

    describe ".active" do
      it "returns only participants with left_at nil" do
        active = create(:meeting_participant, meeting: meeting, user: user, role: "host", joined_at: Time.current)
        create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", joined_at: 1.hour.ago, left_at: Time.current)

        expect(MeetingParticipant.active).to eq([active])
      end
    end

    describe ".host" do
      it "returns only participants with host role" do
        host = create(:meeting_participant, meeting: meeting, user: user, role: "host", joined_at: Time.current)
        create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", joined_at: Time.current)

        expect(MeetingParticipant.host).to eq([host])
      end
    end
  end

  # ============================================================
  # Broadcast Callbacks
  # ============================================================
  describe "broadcast callbacks" do
    let(:other_user) { create(:user) }
    let(:stream_name) { "meeting_#{meeting.id}_transcription" }

    describe "after_create_commit :broadcast_participant_joined" do
      it "broadcasts participant_joined to the meeting transcription stream" do
        expect(ActionCable.server).to receive(:broadcast).with(
          stream_name,
          hash_including(
            type: "participant_joined",
            user_id: other_user.id,
            user_name: other_user.name,
            role: "viewer"
          )
        )

        create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", joined_at: Time.current)
      end

      it "includes participant_id and joined_at in the broadcast" do
        expect(ActionCable.server).to receive(:broadcast).with(stream_name, anything) do |_stream, payload|
          expect(payload[:type]).to eq("participant_joined")
          expect(payload[:participant_id]).to be_a(Integer)
          expect(payload[:joined_at]).to be_a(Time)
        end

        create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", joined_at: Time.current)
      end
    end

    describe "after_update_commit :broadcast_participant_left" do
      let!(:participant) do
        # Suppress broadcast_participant_joined for setup
        allow(ActionCable.server).to receive(:broadcast)
        create(:meeting_participant, meeting: meeting, user: other_user, role: "viewer", joined_at: Time.current)
      end

      before { allow(ActionCable.server).to receive(:broadcast).and_call_original }

      it "broadcasts participant_left when left_at is set" do
        expect(ActionCable.server).to receive(:broadcast).with(
          stream_name,
          hash_including(
            type: "participant_left",
            user_id: other_user.id,
            user_name: other_user.name
          )
        )

        participant.update!(left_at: Time.current)
      end

      it "does NOT broadcast participant_left when other fields change" do
        expect(ActionCable.server).not_to receive(:broadcast).with(
          stream_name,
          hash_including(type: "participant_left")
        )

        participant.update!(role: "host")
      end
    end
  end
end
