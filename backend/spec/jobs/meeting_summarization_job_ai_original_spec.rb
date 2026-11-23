require "rails_helper"

RSpec.describe MeetingSummarizationJob, "AI 원본 보관" do
  around do |example|
    prev = ENV["LLM_PROVIDER"]
    ENV["LLM_PROVIDER"] = "anthropic"
    example.run
  ensure
    prev.nil? ? ENV.delete("LLM_PROVIDER") : ENV["LLM_PROVIDER"] = prev
  end

  let(:user)    { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 발화", applied_to_minutes: false)
    allow_any_instance_of(LlmService).to receive(:refine_notes)
      .and_return({ "notes_markdown" => "## AI 회의록", "ok" => true })
  end

  it "final 저장 시 ai_notes_markdown 도 기록하고 human_edited_at 을 비운다" do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "old",
           human_edited_at: 1.hour.ago, generated_at: 1.day.ago)
    described_class.perform_now(meeting.id, type: "final")
    s = meeting.summaries.find_by(summary_type: "final")
    expect(s.ai_notes_markdown).to eq(s.notes_markdown)
    expect(s.ai_generated_at).to be_present
    expect(s.human_edited_at).to be_nil
  end

  it "realtime 저장은 ai_notes_markdown 을 쓰지 않는다" do
    meeting.update_columns(status: "recording")
    described_class.perform_now(meeting.id, type: "realtime")
    s = meeting.summaries.find_by(summary_type: "realtime")
    expect(s.notes_markdown).to include("AI 회의록")
    expect(s.ai_notes_markdown).to be_nil
  end
end
