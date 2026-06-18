require "rails_helper"

RSpec.describe ChatMessage, "scope columns" do
  it "기존 meeting 챗은 scope_type=meeting 기본값을 가진다" do
    m = create(:chat_message)
    expect(m.scope_type).to eq("meeting")
  end

  it "folder scope 메시지를 meeting 없이 만들 수 있다" do
    msg = ChatMessage.create!(scope_type: "folder", scope_id: 7, user: create(:user),
                              role: "user", content: "폴더 질문", status: "complete")
    expect(msg).to be_persisted
    expect(msg.meeting_id).to be_nil
  end

  it "잘못된 scope_type을 거부한다" do
    msg = ChatMessage.new(scope_type: "team", scope_id: 1, user: create(:user), role: "user", content: "x")
    expect(msg).not_to be_valid
  end

  it "for_scope는 해당 scope 메시지만 반환한다" do
    u = create(:user)
    ChatMessage.create!(scope_type: "folder", scope_id: 1, user: u, role: "user", content: "a", status: "complete")
    ChatMessage.create!(scope_type: "folder", scope_id: 2, user: u, role: "user", content: "b", status: "complete")
    expect(ChatMessage.for_scope("folder", 1).pluck(:content)).to eq(["a"])
  end
end
