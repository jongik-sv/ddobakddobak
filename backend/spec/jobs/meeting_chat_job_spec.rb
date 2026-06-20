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

  it "builds LlmService with the creator's chat LLM config (separate chat model)" do
    meeting.creator.update!(
      llm_provider: "anthropic",
      llm_api_key: "sk-creator-key",
      llm_model: "claude-sonnet-4-6",
      chat_llm_model: "claude-haiku-4-5"
    )

    fake = instance_double(LlmService, answer_question: "ok")
    expect(LlmService).to receive(:new)
      .with(llm_config: hash_including(model: "claude-haiku-4-5"))
      .and_return(fake)

    MeetingChatJob.perform_now(answer.id)
  end

  context "when the LLM appends a followups sentinel" do
    before do
      raw = "답변본문\n<<<FOLLOWUPS>>>[\"질문1\",\"질문2\",\"질문3\"]"
      fake = instance_double(LlmService, answer_question: raw)
      allow(LlmService).to receive(:new).and_return(fake)
    end

    it "splits the body from the suggestions and stores both" do
      MeetingChatJob.perform_now(answer.id)
      answer.reload
      expect(answer.content).to eq("답변본문")
      expect(answer.suggestions).to eq(%w[질문1 질문2 질문3])
      expect(answer.status).to eq("complete")
    end

    it "includes suggestions in the broadcast payload" do
      expect(ActionCable.server).to receive(:broadcast).with(
        "meeting_#{meeting.id}_chat_#{user.id}",
        hash_including(suggestions: %w[질문1 질문2 질문3])
      )
      MeetingChatJob.perform_now(answer.id)
    end
  end

  context "when there is no sentinel in the answer" do
    before do
      fake = instance_double(LlmService, answer_question: "그냥 답변, 센티넬 없음")
      allow(LlmService).to receive(:new).and_return(fake)
    end

    it "keeps the raw content and leaves suggestions empty" do
      MeetingChatJob.perform_now(answer.id)
      answer.reload
      expect(answer.content).to eq("그냥 답변, 센티넬 없음")
      expect(answer.suggestions).to eq([])
    end
  end

  context "when the sentinel is followed by broken JSON" do
    before do
      raw = "답변본문\n<<<FOLLOWUPS>>>[not valid json"
      fake = instance_double(LlmService, answer_question: raw)
      allow(LlmService).to receive(:new).and_return(fake)
    end

    it "falls back gracefully: clean body, empty suggestions" do
      MeetingChatJob.perform_now(answer.id)
      answer.reload
      expect(answer.content).to eq("답변본문")
      expect(answer.suggestions).to eq([])
      expect(answer.status).to eq("complete")
    end
  end

  it "스트리밍으로 답변을 누적하고 complete 시 model_name 을 저장한다" do
    meeting.creator.update!(
      llm_provider: "anthropic",
      llm_api_key: "sk-test-key",
      llm_model: "claude-haiku-4-5"
    )
    fake = instance_double(LlmService)
    allow(LlmService).to receive(:new).and_return(fake)
    allow(fake).to receive(:answer_question) do |_sys, _user, &blk|
      blk.call("답변 ")
      blk.call("내용")
      "답변 내용"
    end
    allow(MeetingChatContext).to receive(:build).and_return({ system_prompt: "s", user_content: "u" })

    MeetingChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.status).to eq("complete")
    expect(answer.content).to eq("답변 내용")
    expect(answer.model_name).to be_present
  end
end
