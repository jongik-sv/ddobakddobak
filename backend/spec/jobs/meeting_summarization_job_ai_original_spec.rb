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

  describe "STT 용어 학습 pre_overwrite 스냅샷" do
    let!(:edited) do
      create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "사람 편집본",
             ai_notes_markdown: "AI 이전본", human_edited_at: 1.hour.ago, generated_at: 1.day.ago)
    end

    it "AI final 이 사람 편집본을 덮어쓰기 직전 pre_overwrite run 생성" do
      expect { described_class.perform_now(meeting.id, type: "final") }
        .to change { SttTermLearningRun.where(trigger: "pre_overwrite").count }.by(1)
      run = SttTermLearningRun.last
      expect(run).to have_attributes(ai_text: "AI 이전본", human_text: "사람 편집본", summary_id: edited.id,
                                     transcript_text: "첫 발화")
      expect(edited.reload.notes_markdown).to include("AI 회의록")
    end

    it "before_overwrite! 가 예외를 던져도 AI final 저장은 진행" do
      allow(SttTermLearning::Snapshot).to receive(:before_overwrite!).and_raise("boom")
      described_class.perform_now(meeting.id, type: "final")
      expect(edited.reload.notes_markdown).to include("AI 회의록")
      expect(edited.ai_notes_markdown).to eq(edited.notes_markdown)
    end
  end
end

# 파일 전사 경유 final 저장(FileTranscriptionJob#generate_summary)도 같은 스냅샷 지점이다.
RSpec.describe FileTranscriptionJob, "STT 용어 학습 pre_overwrite 스냅샷" do
  let(:user)    { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "transcribing") }
  let(:llm)     { instance_double(LlmService) }
  let!(:edited) do
    create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "사람 편집본",
           ai_notes_markdown: "AI 이전본", human_edited_at: 1.hour.ago, generated_at: 1.day.ago)
  end

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    allow(LlmService).to receive(:new).and_return(llm)
    allow(llm).to receive(:refine_notes).and_return({ "notes_markdown" => "## 새 AI", "ok" => true })
    create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
  end

  it "write_ai_final! 이 사람 편집본을 덮어쓰기 직전 pre_overwrite run 생성" do
    expect { described_class.new.send(:generate_summary, meeting) }
      .to change { SttTermLearningRun.where(trigger: "pre_overwrite").count }.by(1)
    expect(SttTermLearningRun.last).to have_attributes(ai_text: "AI 이전본", human_text: "사람 편집본")
    expect(edited.reload.notes_markdown).to eq("## 새 AI")
  end

  it "before_overwrite! 가 예외를 던져도 AI final 저장은 진행" do
    allow(SttTermLearning::Snapshot).to receive(:before_overwrite!).and_raise("boom")
    described_class.new.send(:generate_summary, meeting)
    expect(edited.reload).to have_attributes(notes_markdown: "## 새 AI", ai_notes_markdown: "## 새 AI")
  end
end
