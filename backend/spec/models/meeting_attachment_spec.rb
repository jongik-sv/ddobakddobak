require "rails_helper"

RSpec.describe MeetingAttachment do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  describe "CATEGORIES" do
    it "includes stakeholder alongside the existing categories" do
      expect(MeetingAttachment::CATEGORIES).to match_array(
        %w[agenda reference minutes business_card stakeholder]
      )
    end

    it "accepts stakeholder as a valid category" do
      att = meeting.meeting_attachments.build(
        kind: "file", category: "stakeholder", display_name: "s.md",
        original_filename: "s.md", content_type: "text/markdown",
        file_size: 3, file_path: "/tmp/s.md", uploaded_by_id: user.id, position: 1
      )
      expect(att).to be_valid
    end

    it "rejects an unknown category" do
      att = meeting.meeting_attachments.build(
        kind: "file", category: "not_a_category", display_name: "s.md",
        original_filename: "s.md", content_type: "text/markdown",
        file_size: 3, file_path: "/tmp/s.md", uploaded_by_id: user.id, position: 1
      )
      expect(att).not_to be_valid
      expect(att.errors[:category]).to be_present
    end
  end
end
