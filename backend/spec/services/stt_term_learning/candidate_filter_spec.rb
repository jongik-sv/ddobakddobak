require "rails_helper"

RSpec.describe SttTermLearning::CandidateFilter do
  let(:project) { create(:project) }
  let(:meeting) { create(:meeting, project: project) }
  let(:transcript) { "오늘 우 판 압연 일정과 엠이에스 연동을 논의" }
  let(:filter) { described_class.new(meeting: meeting, transcript_text: transcript, min_confidence: 0.6) }

  def cand(wrong, correct, source: "llm_diff", confidence: 0.9)
    SttTermLearning::Candidate.new(wrong: wrong, correct: correct, category: "STT", definition: nil,
                                   confidence: confidence, source: source)
  end

  it "통과하면 [nil, nil]" do
    expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "excluded 쌍 → skipped_excluded" do
    create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "excluded")
    expect(filter.verdict_for(cand("우판", "후판")).first).to eq("skipped_excluded")
    # 다른 프로젝트의 excluded 는 무관
    other = create(:meeting, project: create(:project))
    f2 = described_class.new(meeting: other, transcript_text: transcript, min_confidence: 0.6)
    expect(f2.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "confirmed/undecided 쌍은 excluded 필터에 걸리지 않는다" do
    create(:stt_misrecognition, project: project, wrong: "우판", correct: "후판", status: "confirmed")
    expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "excluded 는 invalid 보다 먼저 판정한다(처음 걸린 필터 하나)" do
    create(:stt_misrecognition, project: project, wrong: "우", correct: "후판", status: "excluded")
    expect(filter.verdict_for(cand("우", "후판")).first).to eq("skipped_excluded")
  end

  it "wrong==correct / 1자 / 31자 / 숫자·기호만 → skipped_invalid" do
    expect(filter.verdict_for(cand("MES", "mes", source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("우", "후판", source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("우판", "후", source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("가" * 31, "후판", source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("우판", "나" * 31, source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("12-3", "후판", source: "feedback")).first).to eq("skipped_invalid")
    expect(filter.verdict_for(cand("우판", "%% !", source: "feedback")).first).to eq("skipped_invalid")
    # 경계: 2자·30자는 통과
    expect(filter.verdict_for(cand("가" * 30, "후판", source: "feedback"))).to eq([ nil, nil ])
  end

  it "줄 형식 구분자 ( ) [ ] , * : 개행이 든 wrong/correct → skipped_invalid format_chars" do
    [ [ "엠이에스(MES)", "MES" ], [ "엠, 이에스", "MES" ], [ "우판", "후[판]" ], [ "우*판", "후판" ],
      [ "우:판", "후판" ], [ "우\n판", "후판" ], [ "우판", "후\r판" ] ].each do |w, c|
      expect(filter.verdict_for(cand(w, c, source: "feedback"))).to eq([ "skipped_invalid", "format_chars" ]), "#{w.inspect}→#{c.inspect}"
    end
  end

  it "전사 대조는 유니코드 공백(U+3000)·NFD 도 무시" do
    f = described_class.new(meeting: meeting, transcript_text: "오늘 우\u3000판 그리고 #{'엠이에스'.unicode_normalize(:nfd)}", min_confidence: 0.6)
    expect(f.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
    expect(f.verdict_for(cand("엠이에스", "MES"))).to eq([ nil, nil ])
  end

  it "LLM 후보 wrong 이 전사에 없으면 skipped_not_in_transcript (공백 무시: '우 판' 전사도 '우판' 일치)" do
    expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
    expect(filter.verdict_for(cand("엠 이에스", "MES"))).to eq([ nil, nil ])
    expect(filter.verdict_for(cand("후판", "후판재")).first).to eq("skipped_not_in_transcript")
  end

  it "영문 대소문자 무시" do
    f = described_class.new(meeting: meeting, transcript_text: "Mes 시스템", min_confidence: 0.6)
    expect(f.verdict_for(cand("MES", "엠이에스"))).to eq([ nil, nil ])
  end

  it "feedback 후보는 전사에 없어도 통과" do
    expect(filter.verdict_for(cand("후판", "후판재", source: "feedback"))).to eq([ nil, nil ])
  end

  it "같은 wrong 이 실효 세트에 다른 용어로 등록돼 있으면 skipped_conflict" do
    file = create(:domain_file, content: "- **우편** [STT] (오인식: 우판): 우편물")
    DomainFileLink.create!(owner: project, domain_file: file)
    expect(filter.verdict_for(cand("우판", "후판")).first).to eq("skipped_conflict")
    # 같은 용어(correct)에 이미 있는 오인식은 conflict 아님
    expect(filter.verdict_for(cand("우판", "우편"))).to eq([ nil, nil ])
  end

  it "conflict 판정은 회의 자체 링크 파일도 포함하고 exclude 한 파일은 뺀다" do
    file = create(:domain_file, content: "- **우편** (발음: 우판): 우편물")
    DomainFileLink.create!(owner: meeting, domain_file: file)
    expect(filter.verdict_for(cand("우판", "후판")).first).to eq("skipped_conflict")

    folder = create(:folder, project: project)
    m2 = create(:meeting, project: project, folder: folder)
    DomainFileLink.create!(owner: folder, domain_file: file)
    DomainFileLink.create!(owner: m2, domain_file: file, exclude: true)
    f2 = described_class.new(meeting: m2, transcript_text: transcript, min_confidence: 0.6)
    expect(f2.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "같은 실행에서 앞 후보가 통과한 wrong 을 다른 correct 로 내면 skipped_conflict" do
    expect(filter.verdict_for(cand("우판", "후판", source: "feedback"))).to eq([ nil, nil ])
    expect(filter.verdict_for(cand("우판", "우편")).first).to eq("skipped_conflict")
    expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "LLM confidence 0.5 < 0.6 → skipped_low_confidence, feedback 은 면제" do
    expect(filter.verdict_for(cand("우판", "후판", confidence: 0.5)).first).to eq("skipped_low_confidence")
    expect(filter.verdict_for(cand("우판", "후판", confidence: nil)).first).to eq("skipped_low_confidence")
    expect(filter.verdict_for(cand("우판", "후판", confidence: 0.6))).to eq([ nil, nil ])
    expect(filter.verdict_for(cand("후판", "후판재", source: "feedback", confidence: 0.1))).to eq([ nil, nil ])
  end

  it "프로젝트 없는 회의도 크래시 없이 판정" do
    m = build(:meeting, project: nil) # DB 는 project_id NOT NULL — 방어 경로
    f = described_class.new(meeting: m, transcript_text: transcript, min_confidence: 0.6)
    expect(f.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
  end

  it "reason 문자열을 함께 낸다" do
    verdict, reason = filter.verdict_for(cand("우", "후판"))
    expect(verdict).to eq("skipped_invalid")
    expect(reason).to be_a(String).and be_present
  end

  describe "되돌린 쌍(reverted_pair)" do
    def reverted_item(run_meeting, verdict: "registered", status: "reverted", wrong: "우판", correct: "후판")
      run = create(:stt_term_learning_run, meeting: run_meeting, status: status, finished_at: Time.current)
      create(:stt_term_learning_item, run: run, verdict: verdict, wrong: wrong, correct: correct,
             wrong_key: DomainFile.normalize_key(wrong), correct_key: DomainFile.normalize_key(correct))
    end

    it "이 회의의 되돌린 run 에서 적용됐던 쌍 → skipped_excluded / reverted_pair (feedback 도)" do
      reverted_item(meeting)
      expect(filter.verdict_for(cand("우판", "후판"))).to eq([ "skipped_excluded", "reverted_pair" ])
      expect(filter.verdict_for(cand("우판", "후판", source: "feedback"))).to eq([ "skipped_excluded", "reverted_pair" ])
      # 다른 쌍은 무관
      expect(filter.verdict_for(cand("엠이에스", "MES"))).to eq([ nil, nil ])
    end

    it "merged_existing·already_known 적용 항목도 되돌린 쌍" do
      reverted_item(meeting, verdict: "merged_existing")
      reverted_item(meeting, verdict: "already_known", wrong: "엠이에스", correct: "MES")
      expect(filter.verdict_for(cand("우판", "후판")).last).to eq("reverted_pair")
      expect(filter.verdict_for(cand("엠이에스", "MES")).last).to eq("reverted_pair")
    end

    it "건너뛴 항목·done run·다른 회의의 되돌린 run 은 막지 않는다" do
      reverted_item(meeting, verdict: "skipped_low_confidence")
      reverted_item(meeting, status: "done", wrong: "엠이에스", correct: "MES")
      reverted_item(create(:meeting, project: project), wrong: "우판", correct: "후판")
      expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
      expect(filter.verdict_for(cand("엠이에스", "MES"))).to eq([ nil, nil ])
    end
  end

  describe "wrong 이 이미 용어(wrong_is_term)" do
    it "wrong 이 실효 세트의 용어 key 면 skipped_conflict / wrong_is_term" do
      file = create(:domain_file, content: "- **우판** [STT]: 우판 설비\n- **후판**: 두꺼운 강판")
      DomainFileLink.create!(owner: project, domain_file: file)
      expect(filter.verdict_for(cand("우판", "후판"))).to eq([ "skipped_conflict", "wrong_is_term" ])
      expect(filter.verdict_for(cand("우판", "후판", source: "feedback"))).to eq([ "skipped_conflict", "wrong_is_term" ])
      # correct 가 용어인 것은 정상
      expect(filter.verdict_for(cand("엠이에스", "후판"))).to eq([ nil, nil ])
    end

    it "exclude 한 파일의 용어는 보지 않는다" do
      file = create(:domain_file, content: "- **우판**: 우판 설비")
      DomainFileLink.create!(owner: project, domain_file: file)
      DomainFileLink.create!(owner: meeting, domain_file: file, exclude: true)
      expect(filter.verdict_for(cand("우판", "후판"))).to eq([ nil, nil ])
    end
  end
end
