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
end
