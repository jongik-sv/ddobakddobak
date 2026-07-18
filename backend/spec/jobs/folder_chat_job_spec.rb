require "rails_helper"

RSpec.describe FolderChatJob, type: :job do
  let(:project) { create(:project) }
  let(:user) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let!(:question) { create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: user, role: "user", content: "예산?") }
  let!(:answer) { create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: user, role: "assistant", status: "pending", content: "") }

  before do
    allow(FolderChatQueryExpansion).to receive(:expand).and_return(
      FolderChatQueryExpansion::Result.new(keywords: %w[예산], expansions: %w[예산])
    )
    fake = instance_double(LlmService, answer_question: "예산은 오천입니다.")
    allow(LlmService).to receive(:new).and_return(fake)
  end

  it "답변을 채우고 complete로 표시한다" do
    expect(ActionCable.server).to receive(:broadcast).at_least(:once)
    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to eq("예산은 오천입니다.")
    expect(answer.status).to eq("complete")
  end

  it "scope 채널로 broadcast한다" do
    expect(ActionCable.server).to receive(:broadcast).with(
      "chat_folder_#{folder.id}_#{user.id}",
      hash_including(status: "complete")
    )
    FolderChatJob.perform_now(answer.id)
  end

  it "current_user의 chat LLM config로 LlmService를 만든다" do
    user.update!(llm_provider: "anthropic", llm_api_key: "sk", llm_model: "claude-sonnet-4-6", chat_llm_model: "claude-haiku-4-5")
    fake = instance_double(LlmService, answer_question: "ok")
    expect(LlmService).to receive(:new).with(llm_config: hash_including(model: "claude-haiku-4-5")).and_return(fake)
    FolderChatJob.perform_now(answer.id)
  end

  it "LLM 실패 시 error로 표시·broadcast한다" do
    allow(LlmService).to receive(:new).and_raise(StandardError, "boom")
    expect(ActionCable.server).to receive(:broadcast).with(
      "chat_folder_#{folder.id}_#{user.id}",
      hash_including(status: "error", error_message: a_string_including("boom"))
    )
    FolderChatJob.perform_now(answer.id)
    expect(answer.reload.status).to eq("error")
  end

  it "followups 센티넬을 분리한다" do
    fake = instance_double(LlmService, answer_question: "본문\n<<<FOLLOWUPS>>>[\"q1\",\"q2\",\"q3\"]")
    allow(LlmService).to receive(:new).and_return(fake)
    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to eq("본문")
    expect(answer.suggestions).to eq(%w[q1 q2 q3])
  end

  it "mermaid 코드블록 노드 라벨에 따옴표가 없으면 저장 전 새니타이즈한다" do
    raw = "답변\n```mermaid\nflowchart TD\n  A[따옴표 없음] --> B[따옴표 없음]\n```"
    fake = instance_double(LlmService, answer_question: raw)
    allow(LlmService).to receive(:new).and_return(fake)

    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.content).to include('A["따옴표 없음"]')
    expect(answer.content).to include('B["따옴표 없음"]')
  end

  it "질문 content를 query_text로 FolderChatContext에 넘긴다" do
    expect(FolderChatContext).to receive(:build).with(
      hash_including(query_text: "예산?")
    ).and_return({ system_prompt: "sp", user_content: "uc" })
    FolderChatJob.perform_now(answer.id)
  end

  it "스트리밍으로 답변을 누적하고 complete 시 model_name 을 저장한다" do
    user.update!(
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
    allow(FolderChatContext).to receive(:build).and_return({ system_prompt: "s", user_content: "u" })

    FolderChatJob.perform_now(answer.id)
    answer.reload
    expect(answer.status).to eq("complete")
    expect(answer.content).to eq("답변 내용")
    expect(answer.model_name).to be_present
  end
end
