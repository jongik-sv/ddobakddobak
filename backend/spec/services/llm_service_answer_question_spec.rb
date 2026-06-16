# backend/spec/services/llm_service_answer_question_spec.rb
require "rails_helper"

RSpec.describe LlmService, "#answer_question" do
  it "passes system prompt + user content to call_llm_raw and returns answer" do
    svc = LlmService.new(llm_config: { "provider" => "anthropic", "api_key" => "x", "model" => "m" })
    allow(svc).to receive(:call_llm_raw).and_return("회의에서 X를 결정했습니다.")
    answer = svc.answer_question("SYS", "회의 전사...\n질문: 뭐 결정됐어?")
    expect(svc).to have_received(:call_llm_raw).with("SYS", "회의 전사...\n질문: 뭐 결정됐어?")
    expect(answer).to eq("회의에서 X를 결정했습니다.")
  end

  it "exposes MEETING_CHAT_SYSTEM_PROMPT" do
    expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("회의 어시스턴트")
  end

  it "instructs the model to answer bare topic/keyword inputs instead of asking back" do
    expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("주제·키워드").and include("되묻지")
  end
end
