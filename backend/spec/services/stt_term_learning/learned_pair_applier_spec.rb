require "rails_helper"

RSpec.describe SttTermLearning::LearnedPairApplier do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:meeting) { create(:meeting, project: project, creator: user, status: "completed") }
  let(:run) do
    meeting.stt_term_learning_runs.create!(trigger: "pre_overwrite", status: "done", ai_text: "a", human_text: "b",
                                           transcript_text: "", input_digest: SecureRandom.hex)
  end

  def item(wrong, correct, verdict: "registered", run: self.run, misrecognition: nil)
    SttTermLearningItem.create!(run: run, source: "llm_diff", verdict: verdict, wrong: wrong, correct: correct,
                                wrong_key: DomainFile.normalize_key(wrong), correct_key: DomainFile.normalize_key(correct),
                                misrecognition: misrecognition)
  end

  subject(:applier) { described_class.new(meeting) }

  it "학습된 쌍을 치환하고 인용 마커는 보호한다" do
    item("우판", "후판")
    text = "우판 압연 ⟦t:1056250/s:1⟧ 우판"
    expect(applier.apply_text(text)).to eq("후판 압연 ⟦t:1056250/s:1⟧ 후판")
  end

  it "숫자 쌍이 마커 내부를 오염시키지 않는다" do
    item("250", "이오공")
    expect(applier.apply_text("값 250 ⟦t:1056250/s:2⟧")).to eq("값 이오공 ⟦t:1056250/s:2⟧")
  end

  it "멱등: 두 번 적용해도 같다 / correct 가 wrong 을 포함하는 쌍은 건너뛴다" do
    item("API", "API 서버")
    item("우판", "후판")
    once = applier.apply_text("API 와 우판")
    expect(once).to eq("API 와 후판")
    expect(applier.apply_text(once)).to eq(once)
  end

  it "긴 wrong 을 먼저 적용한다" do
    item("우판재", "후판재")
    item("우판", "후판")
    expect(applier.entries.map { |e| e[:from] }).to eq(%w[우판재 우판])
    expect(applier.apply_text("우판재")).to eq("후판재")
  end

  it "1글자 wrong·미적용 verdict·되돌려진 run·excluded 쌍은 건너뛴다" do
    item("가", "나")
    item("비적용", "x1", verdict: "skipped_conflict")
    reverted = meeting.stt_term_learning_runs.create!(trigger: "idle", status: "reverted", ai_text: "a", human_text: "b",
                                                      transcript_text: "", input_digest: SecureRandom.hex)
    item("되돌림", "복원", run: reverted)
    mis = SttMisrecognition.create!(project: project, wrong: "제외", correct: "포함", wrong_key: "제외", correct_key: "포함", status: "excluded")
    item("제외", "포함", misrecognition: mis)
    expect(applier.entries).to be_empty
  end

  it "다른 회의의 학습은 적용하지 않는다" do
    other = create(:meeting, project: project, creator: user, status: "completed")
    r = other.stt_term_learning_runs.create!(trigger: "idle", status: "done", ai_text: "a", human_text: "b",
                                             transcript_text: "", input_digest: SecureRandom.hex)
    item("우판", "후판", run: r)
    expect(applier.apply_text("우판")).to eq("우판")
  end

  it "apply_other_columns! 는 notes 외 요약 컬럼만 치환한다" do
    item("우판", "후판")
    s = create(:summary, meeting: meeting, summary_type: "final", notes_markdown: "우판", key_points: "우판 포인트")
    applier.apply_other_columns!(s)
    s.reload
    expect(s.notes_markdown).to eq("우판")
    expect(s.key_points).to eq("후판 포인트")
  end
end
