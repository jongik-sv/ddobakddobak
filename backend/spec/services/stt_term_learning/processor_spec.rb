require "rails_helper"

# LlmService 는 instance_double 로 stub — 실 LLM 호출 없음.
RSpec.describe SttTermLearning::Processor do
  let(:project) { create(:project) }
  let(:folder) { create(:folder, project: project) }
  let(:meeting) { create(:meeting, project: project, folder: folder) }
  let(:run) do
    create(:stt_term_learning_run, meeting: meeting, trigger: "idle", status: "queued",
           ai_text: "- 우판 압연\n- 저신뢰 말", human_text: "- 후판 압연\n- 저신뢰 밀",
           transcript_text: "오늘 우판 압연 이야기, 저신뢰 말")
  end
  let(:llm_items) do
    [
      { "wrong" => "우판", "correct" => "후판", "category" => "제품", "definition" => "두꺼운 강판", "confidence" => 0.9 },
      { "wrong" => "없는말", "correct" => "있는말", "confidence" => 0.9 },
      { "wrong" => "저신뢰 말", "correct" => "저신뢰밀", "confidence" => 0.2 }
    ]
  end
  let(:llm) { instance_double(LlmService, model_name: "test-model", extract_stt_misrecognitions: llm_items) }
  let!(:human_file) do
    create(:domain_file, project: project, content: "- **후판** [제품]: 두꺼운 강판").tap do |f|
      DomainFileLink.create!(owner: project, domain_file: f)
    end
  end

  before { allow(LlmService).to receive(:new).and_return(llm) }

  def auto_file
    SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(folder))
  end

  it "후보 → items(verdict·source·level·change) 저장, run done" do
    meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")

    result = described_class.new(run).call

    expect(result).to eq(run)
    run.reload
    expect(run.status).to eq("done")
    expect(run.started_at).to be_present
    expect(run.finished_at).to be_present
    expect(run.llm_model).to eq("test-model")
    expect(run.llm_skipped_reason).to be_nil
    expect(run.error).to be_nil

    items = run.items.order(:id).index_by(&:wrong)
    expect(items.keys).to contain_exactly("씨지엘", "우판", "없는말", "저신뢰 말")

    cgl = items["씨지엘"]
    expect(cgl).to have_attributes(correct: "CGL", source: "feedback", verdict: "registered",
                                   domain_file_id: auto_file.id, level_owner_type: "Folder", level_owner_id: folder.id,
                                   wrong_key: "씨지엘", correct_key: "cgl")
    expect(cgl.change_data).to eq("kind" => "add_line", "domain_file_id" => auto_file.id, "term_key" => "cgl",
                                  "line" => "- **CGL** [STT] (오인식: 씨지엘): ")
    expect(auto_file.content).to eq("- **CGL** [STT] (오인식: 씨지엘): ")

    hupan = items["우판"]
    expect(hupan).to have_attributes(source: "llm_diff", verdict: "merged_existing", domain_file_id: human_file.id,
                                     level_owner_type: "Project", level_owner_id: project.id,
                                     category: "제품", definition: "두꺼운 강판", confidence: 0.9)
    expect(hupan.change_data).to include("kind" => "add_mispronunciation", "wrong" => "우판",
                                         "before" => "- **후판** [제품]: 두꺼운 강판")
    expect(human_file.reload.content).to eq("- **후판** [제품] (오인식: 우판): 두꺼운 강판")

    expect(items["없는말"]).to have_attributes(verdict: "skipped_not_in_transcript", domain_file_id: nil,
                                             level_owner_type: nil, level_owner_id: nil, change: nil)
    expect(items["저신뢰 말"]).to have_attributes(verdict: "skipped_low_confidence", change: nil)

    # 오인식 기록: 적용 → confirmed, 저신뢰 → undecided, 전사에 없음 → 기록 안 함
    expect(cgl.misrecognition).to have_attributes(status: "confirmed", hit_count: 1, last_meeting_id: meeting.id)
    expect(hupan.misrecognition.status).to eq("confirmed")
    expect(items["저신뢰 말"].misrecognition.status).to eq("undecided")
    expect(items["없는말"].misrecognition).to be_nil
    expect(SttMisrecognition.count).to eq(3)
  end

  it "flush! 가 결과를 내린 경우(changed_during_run) 내린 판정으로 저장·기록한다" do
    allow_any_instance_of(SttTermLearning::Registrar).to receive(:flush!).and_wrap_original do |orig, *args|
      human_file.update_column(:content, "- **후판** [제품]: 사람이 방금 고침")
      orig.call(*args)
    end

    described_class.new(run).call

    item = run.items.find_by(wrong: "우판")
    expect(item).to have_attributes(verdict: "skipped_conflict", reason: "changed_during_run", change: nil)
    expect(item.misrecognition.status).to eq("undecided")
    expect(human_file.reload.content).to eq("- **후판** [제품]: 사람이 방금 고침")
  end

  it "LLM 미설정이면 llm_skipped_reason 기록, feedback 쌍은 등록" do
    allow(LlmService).to receive(:new).and_raise(LlmService::NotConfiguredError)
    meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")

    described_class.new(run).call

    run.reload
    expect(run).to have_attributes(status: "done", llm_skipped_reason: "llm_not_configured", llm_model: nil)
    expect(run.items.pluck(:wrong, :source, :verdict)).to eq([ [ "씨지엘", "feedback", "registered" ] ])
    expect(auto_file.content).to eq("- **CGL** [STT] (오인식: 씨지엘): ")
  end

  it "후보가 없으면 items 0건으로 done" do
    allow(llm).to receive(:extract_stt_misrecognitions).and_return([])
    described_class.new(run).call
    expect(run.reload).to have_attributes(status: "done")
    expect(run.items).to be_empty
  end

  it "등록 중 예외 → 도메인 파일 변경 롤백, run failed + error" do
    meeting.glossary_entries.create!(from_text: "씨지엘", to_text: "CGL", match_type: "literal")
    allow(SttMisrecognition).to receive(:record_verdict!).and_raise(RuntimeError, "폭발 " + ("x" * 800))

    expect {
      expect { described_class.new(run).call }.not_to raise_error
    }.not_to change { [ DomainFile.count, DomainFileLink.count, SttTermLearningItem.count ] }

    expect(human_file.reload.content).to eq("- **후판** [제품]: 두꺼운 강판")
    expect(auto_file).to be_nil
    run.reload
    expect(run.status).to eq("failed")
    expect(run.error).to start_with("RuntimeError: 폭발")
    expect(run.error.length).to be <= 500
    expect(run.finished_at).to be_present
  end

  it "추출 단계 예외도 failed 로 남긴다" do
    allow_any_instance_of(SttTermLearning::CandidateExtractor).to receive(:call).and_raise(ArgumentError, "bad")
    described_class.new(run).call
    expect(run.reload).to have_attributes(status: "failed", error: "ArgumentError: bad")
  end

  it "queued 가 아니면 no-op" do
    %w[running done failed reverted].each do |st|
      run.update!(status: st)
      described_class.new(run).call
      expect(run.reload.status).to eq(st)
    end
    expect(LlmService).not_to have_received(:new)
    expect(run.items).to be_empty
  end

  it "메모리상 queued 여도 DB 가 이미 running 이면(다른 실행이 선점) no-op" do
    stale = SttTermLearningRun.find(run.id)
    run.update!(status: "running")
    described_class.new(stale).call
    expect(LlmService).not_to have_received(:new)
    expect(run.reload.status).to eq("running")
  end

  it "설정의 min_confidence 를 쓴다" do
    allow(AppSettings).to receive(:stt_term_learning).and_return("enabled" => true, "idle_minutes" => 30, "min_confidence" => 0.1)
    described_class.new(run).call
    expect(run.items.find_by(wrong: "저신뢰 말").verdict).to eq("registered")
  end
end
