# backend/spec/services/meeting_chat_context_spec.rb
require "rails_helper"

RSpec.describe MeetingChatContext do
  let(:meeting) { create(:meeting, title: "프로세스 회의") }
  let(:user) { create(:user) }

  it "includes title, summary, transcript, question" do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "## 핵심 요약\n- 결정 A")
    create(:transcript, meeting: meeting, speaker_label: "화자1", content: "A로 가시죠", started_at_ms: 5000)
    out = described_class.build(meeting: meeting, user: user, question: "결정 뭐야?")
    expect(out[:system_prompt]).to eq(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT)
    uc = out[:user_content]
    expect(uc).to include("회의 제목: 프로세스 회의")
    expect(uc).to include("## 핵심 요약")
    expect(uc).to include("A로 가시죠")
    expect(uc).to include("질문: 결정 뭐야?")
  end

  it "includes recent conversation history" do
    create(:chat_message, meeting: meeting, user: user, role: "user", content: "이전질문")
    create(:chat_message, meeting: meeting, user: user, role: "assistant", status: "complete", content: "이전답변")
    out = described_class.build(meeting: meeting, user: user, question: "후속")
    expect(out[:user_content]).to include("이전 대화:")
    expect(out[:user_content]).to include("이전질문").and include("이전답변")
  end

  it "truncates transcript when over budget and notes omission" do
    stub_const("#{described_class}::MAX_CHARS", 200)
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "요약")
    20.times { |i| create(:transcript, meeting: meeting, speaker_label: "화자1", content: "긴내용#{i}" * 20, started_at_ms: i * 1000, sequence_number: i) }
    out = described_class.build(meeting: meeting, user: user, question: "q")
    expect(out[:user_content].length).to be <= 1500
    expect(out[:user_content]).to include("전사 일부 생략")
  end

  it "caps a huge summary so user_content never exceeds MAX_CHARS" do
    stub_const("#{described_class}::MAX_CHARS", 1000)
    stub_const("#{described_class}::SUMMARY_MAX_CHARS", 500)
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "요" * 5000)
    create(:transcript, meeting: meeting, speaker_label: "화자1", content: "전사내용" * 200, started_at_ms: 0, sequence_number: 0)
    out = described_class.build(meeting: meeting, user: user, question: "q")
    expect(out[:user_content].length).to be <= described_class::MAX_CHARS
    expect(out[:user_content]).to include("요약 일부 생략")
  end
end
