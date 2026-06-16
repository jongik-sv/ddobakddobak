require "rails_helper"

RSpec.describe MeetingChatJob, type: :job do
  let(:meeting) { create(:meeting) }
  let(:user) { create(:user) }
  let!(:question) { create(:chat_message, meeting: meeting, user: user, role: "user", content: "결정?") }
  let!(:answer) { create(:chat_message, meeting: meeting, user: user, role: "assistant", status: "pending", content: "") }

  before do
    fake = instance_double(LlmService, answer_question: "결정은 A입니다.")
    allow(LlmService).to receive(:new).and_return(fake)
  end

  it "fills assistant message and marks complete" do
    expect(ActionCable.server).to receive(:broadcast).at_least(:once)
    MeetingChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to eq("결정은 A입니다.")
    expect(answer.status).to eq("complete")
  end

  it "marks error on LLM failure" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    MeetingChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.status).to eq("error")
    expect(answer.error_message).to include("boom")
  end

  it "broadcasts the error reason so the frontend can render it" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    expect(ActionCable.server).to receive(:broadcast).with(
      "meeting_#{meeting.id}_chat_#{user.id}",
      hash_including(status: "error", error_message: a_string_including("boom"))
    )
    MeetingChatJob.perform_now(answer.id)
  end
end
