require "rails_helper"

RSpec.describe MeetingBookmark, type: :model do
  describe "associations" do
    it { is_expected.to belong_to(:meeting) }
  end

  describe "validations" do
    it { is_expected.to validate_presence_of(:timestamp_ms) }
    it { is_expected.to validate_numericality_of(:timestamp_ms).only_integer.is_greater_than_or_equal_to(0) }

    it "is valid with valid attributes" do
      bookmark = build(:meeting_bookmark)
      expect(bookmark).to be_valid
    end

    it "is invalid without timestamp_ms" do
      bookmark = build(:meeting_bookmark, timestamp_ms: nil)
      expect(bookmark).not_to be_valid
    end

    it "is invalid with negative timestamp_ms" do
      bookmark = build(:meeting_bookmark, timestamp_ms: -1)
      expect(bookmark).not_to be_valid
    end

    it "allows blank label" do
      bookmark = build(:meeting_bookmark, label: nil)
      expect(bookmark).to be_valid
    end
  end
end
