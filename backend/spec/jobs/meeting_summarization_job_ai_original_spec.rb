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

RSpec.describe MeetingSummarizationJob, "STT 학습 순서 보장·확정 치환" do
  include ActiveJob::TestHelper

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

  def make_run(status:, created_at: Time.current, trigger: "pre_overwrite")
    meeting.stt_term_learning_runs.create!(trigger: trigger, status: status, ai_text: "a", human_text: "b",
                                           transcript_text: "", input_digest: SecureRandom.hex, created_at: created_at)
  end

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    create(:transcript, meeting: meeting, sequence_number: 1, content: "첫 발화", applied_to_minutes: false)
    allow_any_instance_of(LlmService).to receive(:refine_notes)
      .and_return({ "notes_markdown" => "## 우판 회의록 ⟦t:1056250/s:1⟧", "ok" => true })
  end

  describe "A. 대기" do
    it "대기 중인 pre_overwrite run 이 있으면 5초 뒤로 재enqueue 하고 요약·broadcast 는 하지 않는다" do
      make_run(status: "queued")
      expect(ActionCable.server).not_to receive(:broadcast)
      expect {
        described_class.perform_now(meeting.id, type: "final", attempt: 2)
      }.to have_enqueued_job(described_class).with(meeting.id, type: "final", attempt: 2).at(a_value_within(2.seconds).of(5.seconds.from_now))
      expect(meeting.summaries.where(summary_type: "final")).to be_empty
    end

    it "running 도 대기" do
      make_run(status: "running")
      expect { described_class.perform_now(meeting.id, type: "final") }.to have_enqueued_job(described_class)
    end

    it "창(3분)이 지난 run 은 무시하고 진행" do
      make_run(status: "queued", created_at: 4.minutes.ago)
      expect { described_class.perform_now(meeting.id, type: "final") }.not_to have_enqueued_job(described_class)
      expect(meeting.summaries.find_by(summary_type: "final")).to be_present
    end

    it "done run 이면 진행" do
      make_run(status: "done")
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.summaries.find_by(summary_type: "final")).to be_present
    end

    it "idle/manual run 도 진행 중이면 기다린다(트리거 무관)" do
      make_run(status: "running", trigger: "idle")
      expect { described_class.perform_now(meeting.id, type: "final") }.to have_enqueued_job(described_class)
      make_run(status: "queued", trigger: "manual")
      expect { described_class.perform_now(meeting.id, type: "final") }.to have_enqueued_job(described_class)
    end

    it "대기 중에도 요약 중 상태를 영속해 새로고침·409 가드가 유지된다" do
      make_run(status: "queued")
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.reload.summarizing?).to be(true)
    end

    it "대기 해제 후 진행하면 finished 로 요약 중이 해제된다" do
      make_run(status: "done")
      meeting.record_summary_start!
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.reload.summarizing?).to be(false)
    end

    it "대기 후 조기 반환(전사 없음)에서도 요약 중이 해제된다" do
      meeting.record_summary_start!
      meeting.transcripts.destroy_all
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.reload.summarizing?).to be(false)
    end

    it "학습 비활성이면 기다리지 않는다" do
      make_run(status: "queued")
      allow(AppSettings).to receive(:stt_term_learning).and_return({ "enabled" => false })
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.summaries.find_by(summary_type: "final")).to be_present
    end
  end

  describe "B. 확정 치환" do
    def learn(wrong, correct)
      run = make_run(status: "done")
      file = create(:domain_file, creator: user, content: "- **#{correct}**: 설명")
      SttTermLearningItem.create!(run: run, source: "llm_diff", verdict: "registered", wrong: wrong, correct: correct,
                                  domain_file: file, wrong_key: DomainFile.normalize_key(wrong), correct_key: DomainFile.normalize_key(correct))
    end

    it "재작성 후에도 학습된 용어가 유지되고 ai_notes 도 치환본, 마커는 보존" do
      learn("우판", "후판")
      described_class.perform_now(meeting.id, type: "final")
      s = meeting.summaries.find_by(summary_type: "final")
      expect(s.notes_markdown).to eq("## 후판 회의록 ⟦t:1056250/s:1⟧")
      expect(s.ai_notes_markdown).to eq(s.notes_markdown)
      expect(meeting.reload.brief_summary.to_s).not_to include("우판")
    end

    it "학습 비활성이면 치환하지 않는다" do
      learn("우판", "후판")
      allow(AppSettings).to receive(:stt_term_learning).and_return({ "enabled" => false })
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to include("우판")
    end

    it "치환 로드 실패는 요약 저장을 막지 않는다" do
      allow_any_instance_of(SttTermLearning::LearnedPairApplier).to receive(:entries).and_raise("boom")
      described_class.perform_now(meeting.id, type: "final")
      expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to include("우판")
    end
  end
end

RSpec.describe FileTranscriptionJob, "학습된 쌍 확정 치환" do
  let(:user)    { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "transcribing") }
  let(:llm)     { instance_double(LlmService) }

  before do
    allow(AppSettings).to receive(:refresh_env_if_changed!)
    allow(LlmService).to receive(:new).and_return(llm)
    allow(llm).to receive(:refine_notes).and_return({ "notes_markdown" => "## 우판 회의록 ⟦t:1056250/s:1⟧", "ok" => true })
    create(:transcript, meeting: meeting, sequence_number: 1, content: "발화", applied_to_minutes: false)
    run = meeting.stt_term_learning_runs.create!(trigger: "pre_overwrite", status: "done", ai_text: "a", human_text: "b",
                                                 transcript_text: "", input_digest: SecureRandom.hex)
    file = create(:domain_file, creator: user, content: "- **후판**: 설명")
    SttTermLearningItem.create!(run: run, source: "llm_diff", verdict: "registered", wrong: "우판", correct: "후판",
                                wrong_key: "우판", correct_key: "후판", domain_file: file)
  end

  it "STT 재생성 경로의 final 에도 학습 쌍을 치환(마커 보존)하고 ai_notes 도 치환본" do
    described_class.new.send(:generate_summary, meeting)
    s = meeting.summaries.find_by(summary_type: "final")
    expect(s.notes_markdown).to eq("## 후판 회의록 ⟦t:1056250/s:1⟧")
    expect(s.ai_notes_markdown).to eq(s.notes_markdown)
  end

  it "치환 로드 실패는 저장을 막지 않는다" do
    allow_any_instance_of(SttTermLearning::LearnedPairApplier).to receive(:entries).and_raise("boom")
    described_class.new.send(:generate_summary, meeting)
    expect(meeting.summaries.find_by(summary_type: "final").notes_markdown).to include("우판")
  end
end
