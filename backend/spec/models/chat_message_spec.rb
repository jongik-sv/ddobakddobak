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
end
