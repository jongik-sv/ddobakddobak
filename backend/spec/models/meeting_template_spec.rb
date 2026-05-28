require "rails_helper"

RSpec.describe MeetingTemplate, type: :model do
  describe "associations" do
    it { is_expected.to belong_to(:folder).optional }
    it { is_expected.not_to respond_to(:user) }
  end

  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_length_of(:name).is_at_most(100) }
  end

  describe "global scope" do
    it "creates a template without a user" do
      expect { create(:meeting_template) }.to change(MeetingTemplate, :count).by(1)
    end
  end
end
