require "rails_helper"

RSpec.describe SttTermLearning::Reverter do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:meeting) { create(:meeting, project: project, folder: child) }
  let(:run) { create(:stt_term_learning_run, meeting: meeting, status: "done") }
  let(:child_auto) { -> { SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(child)) } }

  def cand(wrong, correct, definition: nil)
    SttTermLearning::Candidate.new(wrong: wrong, correct: correct, category: nil, definition: definition,
                                   confidence: 0.9, source: "llm_diff")
  end

  def human_file(content, owner)
    create(:domain_file, content: content).tap { |f| DomainFileLink.create!(owner: owner, domain_file: f) }
  end

  # 실제 Registrar 결과로 item 을 만든다(Processor(T7) 와 같은 모양: change 는 String 키 JSON).
  def learn(a_run, *cands)
    registrar = SttTermLearning::Registrar.new(a_run.meeting)
    pairs = cands.map { |c| [ c, registrar.register(c) ] }
    registrar.flush!
    pairs.map do |c, r|
      mis = SttMisrecognition.record_verdict!(meeting: a_run.meeting, wrong: c.wrong, correct: c.correct, verdict: r[:verdict])
      create(:stt_term_learning_item, run: a_run, wrong: c.wrong, correct: c.correct, wrong_key: c.wrong_key,
             correct_key: c.correct_key, source: c.source, verdict: r[:verdict], reason: r[:reason],
             domain_file_id: r[:domain_file]&.id, level_owner_type: r[:level]&.type, level_owner_id: r[:level]&.owner&.id,
             change: r[:change]&.to_json, misrecognition: mis)
    end
  end

  it "등록 3건(새 줄 2·병합 1) 되돌리면 새 줄 삭제·병합 오인식 제거, run reverted, hit_count 차감" do
    original = "머리말\n- **MES** [시스템명] (발음: 엠에스): 제조실행시스템\n꼬리말"
    human = human_file(original, parent)
    items = learn(run, cand("우판", "후판", definition: "두꺼운 강판"), cand("코일러", "권취기"), cand("엠이에스", "MES"))
    expect(items.map(&:verdict)).to eq(%w[registered registered merged_existing])
    expect(child_auto.().content).to eq("- **후판** [STT] (오인식: 우판): 두꺼운 강판\n- **권취기** [STT] (오인식: 코일러): ")
    expect(human.reload.content).to include("엠이에스")

    result = described_class.new(run).call

    expect(result).to eq(reverted: 3, skipped_item_ids: [])
    expect(child_auto.().content).to eq("")
    expect(human.reload.content).to eq(original)
    expect(run.reload.status).to eq("reverted")
    expect(items.map { |i| i.reload.revert_result }).to all(eq("reverted"))
    items.each do |i|
      expect(i.misrecognition.reload.hit_count).to eq(0)
      expect(i.misrecognition.status).to eq("undecided")
    end
  end

  it "그 사이 사람이 새 줄 설명을 고쳤으면 그 항목만 skipped_changed 로 남기고 나머지는 되돌린다" do
    _first, edited_item, _third = learn(run, cand("우판", "후판"), cand("코일러", "권취기"), cand("에이피", "API"))
    file = child_auto.()
    file.update!(content: file.content.sub("(오인식: 코일러): ", "(오인식: 코일러): 사람이 쓴 설명"))

    result = described_class.new(run).call

    expect(result[:skipped_item_ids]).to eq([ edited_item.id ])
    expect(result[:reverted]).to eq(2)
    expect(edited_item.reload.revert_result).to eq("skipped_changed")
    expect(file.reload.content).to eq("- **권취기** [STT] (오인식: 코일러): 사람이 쓴 설명")
    expect(run.reload.status).to eq("reverted")
  end

  it "같은 실행에서 한 줄에 합친 두 항목(add_line 2개)은 첫 처리에서 줄 삭제, 두 번째는 already_absent" do
    first, second = learn(run, cand("우판", "후판"), cand("후반", "후판"))
    expect([ first.verdict, second.verdict ]).to eq(%w[registered registered])
    expect(first.change_data["line"]).to eq("- **후판** [STT] (오인식: 우판, 후반): ")
    expect(second.change_data["line"]).to eq(first.change_data["line"])

    result = described_class.new(run).call

    expect(result).to eq(reverted: 1, skipped_item_ids: [])
    expect(second.reload.revert_result).to eq("reverted")
    expect(first.reload.revert_result).to eq("already_absent")
    expect(child_auto.().content).to eq("")
  end

  it "같은 실행에서 한 사람 줄에 병합한 두 오인식은 발음 표기·CRLF 까지 원래 줄로 정확히 복원" do
    original = "머리말\r\n- **MES** [시스템명] (발음: 엠에스): 제조실행시스템\r\n꼬리말"
    human = human_file(original, parent)
    items = learn(run, cand("엠이에스", "MES"), cand("엠이에쓰", "MES"))
    expect(items.map(&:verdict)).to eq(%w[merged_existing merged_existing])
    expect(human.reload.content).to eq("머리말\r\n- **MES** [시스템명] (오인식: 엠에스, 엠이에스, 엠이에쓰): 제조실행시스템\r\n꼬리말")

    result = described_class.new(run).call

    expect(result).to eq(reverted: 2, skipped_item_ids: [])
    expect(human.reload.content).to eq(original)
    expect(items.map { |i| i.reload.revert_result }).to all(eq("reverted"))
  end

  it "뒤 실행이 같은 줄에 또 병합했으면 이 실행의 변형만 뺀다" do
    human = human_file("- **MES** [시스템명]: 제조실행시스템", parent)
    learn(run, cand("엠이에스", "MES"))
    run2 = create(:stt_term_learning_run, meeting: meeting, status: "done")
    learn(run2, cand("엠이에쓰", "MES"))

    expect(described_class.new(run).call).to eq(reverted: 1, skipped_item_ids: [])
    expect(human.reload.content).to eq("- **MES** [시스템명] (오인식: 엠이에쓰): 제조실행시스템")
    expect(described_class.new(run2).call).to eq(reverted: 1, skipped_item_ids: [])
    expect(human.reload.content).to eq("- **MES** [시스템명]: 제조실행시스템")
  end

  it "사람이 병합된 오인식을 이미 지웠으면 skipped_changed" do
    human = human_file("- **MES** [시스템명]: 제조실행시스템", parent)
    item, = learn(run, cand("엠이에스", "MES"))
    human.update!(content: "- **MES** [시스템명]: 제조실행시스템(사람 수정)")

    expect(described_class.new(run).call).to eq(reverted: 0, skipped_item_ids: [ item.id ])
    expect(item.reload.revert_result).to eq("skipped_changed")
    expect(human.reload.content).to eq("- **MES** [시스템명]: 제조실행시스템(사람 수정)")
  end

  it "새 줄이 다른 레벨로 이동됐으면(그 파일에 없음) skipped_changed, 이동된 줄은 그대로" do
    item, = learn(run, cand("우판", "후판"))
    SttTermLearning::TermMover.new(actor: meeting.creator)
      .apply!([ { domain_file_id: child_auto.().id, term_keys: [ "후판" ], target: SttTermLearning::Level.for(project) } ])
    project_auto = SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(project))
    expect(project_auto.content).to include("**후판**")

    expect(described_class.new(run).call).to eq(reverted: 0, skipped_item_ids: [ item.id ])
    expect(item.reload.revert_result).to eq("skipped_changed")
    expect(project_auto.reload.content).to include("**후판**")
  end

  it "나중에 수동 등록한 앞 id 항목이 새 줄에 병합됐어도 쓴 순서의 역순으로 되돌려 전부 지운다" do
    early = create(:stt_term_learning_item, run: run, wrong: "후반", correct: "후판", wrong_key: "후반", correct_key: "후판",
                   verdict: "skipped_low_confidence")
    later, = learn(run, cand("우판", "후판"))
    expect(early.id).to be < later.id
    SttTermLearning::ManualRegistration.call(early)
    expect(early.reload.verdict).to eq("merged_existing")
    expect(child_auto.().content).to eq("- **후판** [STT] (오인식: 우판, 후반): ")

    expect(described_class.new(run).call).to eq(reverted: 2, skipped_item_ids: [])
    expect(child_auto.().content).to eq("")
    expect([ early.reload.revert_result, later.reload.revert_result ]).to eq(%w[reverted reverted])
  end

  it "hit_count 0 이 되면 undecided" do
    items = learn(run, cand("우판", "후판"), cand("코일러", "권취기"), cand("에이피", "API"))
    many, one, excluded = items.map(&:misrecognition)
    many.update!(hit_count: 3, status: "confirmed")
    excluded.update!(status: "excluded")

    described_class.new(run).call

    expect([ many.reload.hit_count, many.status ]).to eq([ 2, "confirmed" ])
    expect([ one.reload.hit_count, one.status ]).to eq([ 0, "undecided" ])
    expect([ excluded.reload.hit_count, excluded.status ]).to eq([ 0, "excluded" ])
  end

  it "hit_count 는 0 미만으로 내려가지 않는다" do
    item, = learn(run, cand("우판", "후판"))
    item.misrecognition.update!(hit_count: 0)
    described_class.new(run).call
    expect(item.misrecognition.reload.hit_count).to eq(0)
  end

  it "change 없는 항목(already_known·skipped)은 파일을 건드리지 않고 revert_result 도 없다" do
    human_file("- **후판** [STT] (오인식: 우판): 두꺼운 강판", parent)
    known, = learn(run, cand("우판", "후판"))
    expect(known.verdict).to eq("already_known")
    skipped = create(:stt_term_learning_item, run: run, verdict: "skipped_low_confidence", wrong: "가나", correct: "다라",
                     wrong_key: "가나", correct_key: "다라")

    expect(described_class.new(run).call).to eq(reverted: 0, skipped_item_ids: [])
    expect(known.reload.revert_result).to be_nil
    expect(skipped.reload.revert_result).to be_nil
    expect(known.misrecognition.reload.hit_count).to eq(0)
  end

  it "done 이 아닌 run 은 Error" do
    %w[queued running failed reverted].each do |status|
      r = create(:stt_term_learning_run, meeting: meeting, status: status)
      expect { described_class.new(r).call }.to raise_error(SttTermLearning::Reverter::Error)
    end
  end

  it "중간 실패 시 전부 롤백" do
    human = human_file("- **MES** [시스템명]: 제조실행시스템", parent)
    items = learn(run, cand("우판", "후판"), cand("엠이에스", "MES"))
    before_auto = child_auto.().content
    before_human = human.reload.content
    allow(run).to receive(:update!).and_raise(ActiveRecord::RecordInvalid.new(run))

    expect { described_class.new(run).call }.to raise_error(SttTermLearning::Reverter::Error)
    expect(child_auto.().content).to eq(before_auto)
    expect(human.reload.content).to eq(before_human)
    expect(items.map { |i| i.reload.revert_result }).to all(be_nil)
    expect(items.map { |i| i.misrecognition.reload.hit_count }).to all(eq(1))
    expect(run.reload.status).to eq("done")
  end
end
