require "rails_helper"

RSpec.describe ChatMessage, type: :model do
  it "belongs to meeting and user" do
    msg = create(:chat_message)
    expect(msg.meeting).to be_present
    expect(msg.user).to be_present
  end

  it "rejects invalid role" do
    expect(build(:chat_message, role: "bot")).not_to be_valid
  end

  it "requires content for user role" do
    expect(build(:chat_message, role: "user", content: "")).not_to be_valid
  end

  it "allows empty content for pending assistant" do
    expect(build(:chat_message, role: "assistant", status: "pending", content: "")).to be_valid
  end

  it "for_user scope filters by owner" do
    a = create(:chat_message)
    create(:chat_message)
    expect(ChatMessage.for_user(a.user)).to eq([a])
  end

  describe "#suggestions" do
    it "defaults to an empty array" do
      msg = create(:chat_message)
      expect(msg.reload.suggestions).to eq([])
    end

    it "round-trips an array of strings through the writer" do
      msg = create(:chat_message)
      msg.suggestions = %w[질문1 질문2 질문3]
      msg.save!
      expect(msg.reload.suggestions).to eq(%w[질문1 질문2 질문3])
    end

    it "returns [] when the stored JSON is broken" do
      msg = create(:chat_message)
      msg.update_column(:suggestions_json, "not json{")
      expect(msg.reload.suggestions).to eq([])
    end

    it "coerces non-string entries to strings and caps at 3" do
      msg = create(:chat_message)
      msg.suggestions = ["a", 2, "c", "d"]
      msg.save!
      expect(msg.reload.suggestions).to eq(%w[a 2 c])
    end

    it "ignores a non-array writer value" do
      msg = create(:chat_message)
      msg.suggestions = "nope"
      msg.save!
      expect(msg.reload.suggestions).to eq([])
    end
  end
end
