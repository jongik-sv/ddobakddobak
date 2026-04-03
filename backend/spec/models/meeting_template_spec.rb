require "rails_helper"

RSpec.describe MeetingTemplate, type: :model do
  describe "associations" do
    it { is_expected.to belong_to(:user) }
    it { is_expected.to belong_to(:folder).optional }
  end

  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_length_of(:name).is_at_most(100) }
  end

  describe "User#meeting_templates" do
    let(:user) { create(:user) }

    it "destroys templates when user is destroyed" do
      create(:meeting_template, user: user)
      expect { user.destroy }.to change(MeetingTemplate, :count).by(-1)
    end
  end
end
