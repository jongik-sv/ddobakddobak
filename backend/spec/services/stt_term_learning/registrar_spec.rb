require "rails_helper"

RSpec.describe SttTermLearning::Registrar do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:meeting) { create(:meeting, project: project, folder: child) }
  let(:registrar) { described_class.new(meeting) }
  let(:auto_for) { ->(owner) { SttTermLearning::AutoDomainFile.find_for(owner ? SttTermLearning::Level.for(owner) : SttTermLearning::Level.global) } }

  def cand(wrong, correct, category: nil, definition: nil, source: "llm_diff")
    SttTermLearning::Candidate.new(wrong: wrong, correct: correct, category: category, definition: definition,
                                   confidence: 0.9, source: source)
  end

  def human_file(content, owner)
    create(:domain_file, content: content).tap { |f| DomainFileLink.create!(owner: owner, domain_file: f) }
  end

  def count_domain_file_updates
    count = 0
    sub = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      count += 1 if payload[:sql] =~ /\AUPDATE "domain_files"/
    end
    yield
    count
  ensure
    ActiveSupport::Notifications.unsubscribe(sub)
  end

  it "체인 어디에도 없으면 가장 가까운 폴더 자동 파일에 새 줄 → registered, 폴더에 링크" do
    r = registrar.register(cand("우판", "후판", definition: "두꺼운 강판")); registrar.flush!
    expect(r[:verdict]).to eq("registered")
    file = SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(child))
    expect(file.content).to eq("- **후판** [STT] (오인식: 우판): 두꺼운 강판")
    expect(child.reload.domain_files).to include(file)
    expect(r[:domain_file]).to eq(file)
    expect(r[:level]).to eq(SttTermLearning::Level.for(child))
    expect(r[:change]).to eq("kind" => "add_line", "domain_file_id" => file.id, "term_key" => "후판",
                             "line" => "- **후판** [STT] (오인식: 우판): 두꺼운 강판")
  end

  it "새 줄 분류는 LLM 값, 설명 없으면 빈 문자열, 설명은 60자로 자른다" do
    registrar.register(cand("엠이에스", "MES", category: "시스템명"))
    registrar.register(cand("우판", "후판", definition: "가" * 80))
    registrar.flush!
    expect(auto_for.(child).content).to eq("- **MES** [시스템명] (오인식: 엠이에스): \n- **후판** [STT] (오인식: 우판): #{'가' * 60}")
  end

  it "상위 폴더 사람 파일에 같은 용어가 있으면 그 줄에 병합 → merged_existing, 원 줄 정의 보존" do
    human = create(:domain_file, content: "- **MES** [시스템명]: 제조실행시스템"); DomainFileLink.create!(owner: parent, domain_file: human)
    r = registrar.register(cand("엠이에스", "mes")); registrar.flush!
    expect(r[:verdict]).to eq("merged_existing")
    expect(human.reload.content).to eq("- **MES** [시스템명] (오인식: 엠이에스): 제조실행시스템")
    expect(r[:change]).to eq("kind" => "add_mispronunciation", "domain_file_id" => human.id, "term_key" => "mes", "wrong" => "엠이에스")
    expect(r[:level]).to eq(SttTermLearning::Level.for(parent))
    expect(r[:domain_file]).to eq(human)
    expect(auto_for.(child)).to be_nil
  end

  it "사람 줄의 기존 발음 표기·분류·설명은 LLM 값으로 덮어쓰지 않는다" do
    human = human_file("머리말\n- **MES** [시스템명] (발음: 엠에스): 제조실행시스템\n꼬리말", parent)
    registrar.register(cand("엠이에스", "MES", category: "약어", definition: "다른 설명")); registrar.flush!
    expect(human.reload.content).to eq("머리말\n- **MES** [시스템명] (오인식: 엠에스, 엠이에스): 제조실행시스템\n꼬리말")
  end

  it "프로젝트·전역 자동 파일까지 올라가 찾는다(가장 가까운 레벨 우선)" do
    global = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: meeting.creator)
    global.update!(content: "- **후판** [STT]: 전역")
    r1 = registrar.register(cand("우판", "후판"))
    expect(r1[:verdict]).to eq("merged_existing")
    expect(r1[:level]).to eq(SttTermLearning::Level.global)

    proj = human_file("- **후판** [STT]: 프로젝트", project)
    r2 = described_class.new(meeting).register(cand("후 판", "후판"))
    expect(r2[:domain_file]).to eq(proj)
    expect(r2[:level]).to eq(SttTermLearning::Level.for(project))

    near = human_file("- **후판**: 상위폴더", parent)
    r3 = described_class.new(meeting).register(cand("우반", "후판"))
    expect(r3[:domain_file]).to eq(near)
  end

  it "같은 레벨 안에서는 링크 id 순, 사람·자동 구분 없이 먼저 링크된 파일" do
    first = human_file("- **후판**: 첫째", child)
    human_file("- **후판**: 둘째", child)
    r = registrar.register(cand("우판", "후판")); registrar.flush!
    expect(r[:domain_file]).to eq(first)
    expect(first.reload.content).to eq("- **후판** (오인식: 우판): 첫째")
  end

  it "이미 오인식에 있으면 already_known, 파일 미변경" do
    human = human_file("- **후판** [STT] (오인식: 우판): 두꺼운 강판", parent)
    before = human.reload.updated_at
    r = nil
    updates = count_domain_file_updates { r = registrar.register(cand("우판", "후판")); registrar.flush! }
    expect(r[:verdict]).to eq("already_known")
    expect(r[:change]).to be_nil
    expect(r[:domain_file]).to eq(human)
    expect(updates).to eq(0)
    expect(human.reload.updated_at).to eq(before)
  end

  it "같은 실행에서 이미 보류한 병합과 같은 wrong 이면 already_known" do
    human_file("- **후판**: 두꺼운 강판", parent)
    expect(registrar.register(cand("우판", "후판"))[:verdict]).to eq("merged_existing")
    expect(registrar.register(cand("우판", "후판", source: "feedback"))[:verdict]).to eq("already_known")
  end

  it "형제·자손 폴더에만 같은 용어가 있으면 건드리지 않고 내 폴더에 새 줄(하위 비간섭)" do
    sibling = create(:folder, project: project, parent: parent)
    grandchild = create(:folder, project: project, parent: child)
    sib_file = human_file("- **후판**: 형제", sibling)
    gc_file = human_file("- **후판**: 자손", grandchild)
    r = registrar.register(cand("우판", "후판")); registrar.flush!
    expect(r[:verdict]).to eq("registered")
    expect(r[:domain_file]).to eq(auto_for.(child))
    expect(sib_file.reload.content).to eq("- **후판**: 형제")
    expect(gc_file.reload.content).to eq("- **후판**: 자손")
  end

  it "같은 실행에서 correct 같은 두 쌍 → 한 줄에 오인식 2개, 저장 1회, 두 change 모두 add_line·같은 line" do
    r1 = r2 = nil
    registrar # 파일 생성(INSERT)과 무관하게 UPDATE 만 센다
    updates = count_domain_file_updates do
      r1 = registrar.register(cand("우판", "후판", definition: "두꺼운 강판"))
      r2 = registrar.register(cand("후 반", "후판"))
      registrar.flush!
    end
    line = "- **후판** [STT] (오인식: 우판, 후 반): 두꺼운 강판"
    expect(auto_for.(child).content).to eq(line)
    expect(updates).to eq(1)
    expect([ r1[:verdict], r2[:verdict] ]).to eq(%w[registered registered])
    expect(r1[:change]).to eq("kind" => "add_line", "domain_file_id" => auto_for.(child).id, "term_key" => "후판", "line" => line)
    expect(r2[:change]).to eq(r1[:change])
  end

  it "한 파일에 병합과 새 줄이 섞여도 저장은 파일마다 1회" do
    auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: meeting.creator)
    auto.update!(content: "- **후판** [STT]: 두꺼운 강판")
    updates = count_domain_file_updates do
      registrar.register(cand("우판", "후판"))
      registrar.register(cand("엠이에스", "MES"))
      registrar.register(cand("후반", "후판"))
      registrar.flush!
    end
    expect(updates).to eq(1)
    expect(auto.reload.content).to eq("- **후판** [STT] (오인식: 우판, 후반): 두꺼운 강판\n- **MES** [STT] (오인식: 엠이에스): ")
  end

  it "폴더 없는 회의는 프로젝트 자동 파일" do
    m = create(:meeting, project: project)
    reg = described_class.new(m)
    r = reg.register(cand("우판", "후판")); reg.flush!
    expect(r[:verdict]).to eq("registered")
    expect(r[:level]).to eq(SttTermLearning::Level.for(project))
    expect(auto_for.(project).content).to eq("- **후판** [STT] (오인식: 우판): ")
    expect(project.reload.domain_files).to include(auto_for.(project))
  end

  it "폴더·프로젝트 모두 없는 회의는 skipped_no_level" do
    m = build(:meeting, project: nil, folder: nil) # DB 는 project_id NOT NULL — 방어 경로
    reg = described_class.new(m)
    r = nil
    expect { r = reg.register(cand("우판", "후판")); reg.flush! }.not_to change(DomainFile, :count)
    expect(r[:verdict]).to eq("skipped_no_level")
    expect(r[:domain_file]).to be_nil
    expect(r[:level]).to be_nil
    expect(r[:change]).to be_nil
  end

  it "폴더·프로젝트 모두 없는 회의도 전역 파일에 있는 용어면 병합" do
    global = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.global, fallback_creator: meeting.creator)
    global.update!(content: "- **후판** [STT]: 전역")
    m = build(:meeting, project: nil, folder: nil) # DB 는 project_id NOT NULL — 방어 경로
    reg = described_class.new(m)
    r = reg.register(cand("우판", "후판")); reg.flush!
    expect(r[:verdict]).to eq("merged_existing")
    expect(global.reload.content).to eq("- **후판** [STT] (오인식: 우판): 전역")
  end

  it "링크가 지워진 기존 자동 파일에 이미 그 용어가 있으면 add_line 이 아니라 병합" do
    auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: meeting.creator)
    auto.update!(content: "- **후판** [STT]: 두꺼운 강판")
    DomainFileLink.where(domain_file: auto).destroy_all
    r = registrar.register(cand("우판", "후판")); registrar.flush!
    expect(r[:verdict]).to eq("merged_existing")
    expect(r[:change]).to eq("kind" => "add_mispronunciation", "domain_file_id" => auto.id, "term_key" => "후판", "wrong" => "우판")
    expect(auto.reload.content).to eq("- **후판** [STT] (오인식: 우판): 두꺼운 강판")
  end

  it "flush 뒤 다시 register 하면 저장된 내용을 기준으로 판단" do
    registrar.register(cand("우판", "후판")); registrar.flush!
    r = registrar.register(cand("우판", "후판"))
    expect(r[:verdict]).to eq("already_known")
    r2 = registrar.register(cand("후반", "후판")); registrar.flush!
    expect(r2[:verdict]).to eq("merged_existing")
    expect(auto_for.(child).content).to eq("- **후판** [STT] (오인식: 우판, 후반): ")
  end

  describe "파일 용량(MAX_CONTENT_CHARS) 초과" do
    it "자동 파일이 가득 차면 크래시 없이 skipped_invalid/file_full, 다른 후보는 계속" do
      auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: meeting.creator)
      filler = "x" * (DomainFile::MAX_CONTENT_CHARS - 40)
      auto.update!(content: "#{filler}\n- **MES**: 제조")
      r1 = registrar.register(cand("우판", "후판", definition: "두꺼운 강판 두꺼운 강판 두꺼운 강판")) # 새 줄 → 초과
      r2 = registrar.register(cand("엠이", "MES")) # 기존 줄 병합 → 들어감
      expect { registrar.flush! }.not_to raise_error
      expect(r1).to include(verdict: "skipped_invalid", reason: "file_full", change: nil)
      expect(r2[:verdict]).to eq("merged_existing")
      expect(auto.reload.content).to eq("#{filler}\n- **MES** (오인식: 엠이): 제조")
      expect(auto.content.length).to be <= DomainFile::MAX_CONTENT_CHARS
    end

    it "정확히 한도까지는 들어간다" do
      auto = SttTermLearning::AutoDomainFile.find_or_create_for!(SttTermLearning::Level.for(child), fallback_creator: meeting.creator)
      line = "- **후판** [STT] (오인식: 우판): "
      auto.update!(content: "x" * (DomainFile::MAX_CONTENT_CHARS - line.length - 1))
      r = registrar.register(cand("우판", "후판")); registrar.flush!
      expect(r[:verdict]).to eq("registered")
      expect(auto.reload.content.length).to eq(DomainFile::MAX_CONTENT_CHARS)
    end

    it "register 뒤 flush 전에 파일이 늘어 한도를 넘기면 그 파일 보류분만 file_full, 다른 파일은 저장" do
      a = human_file("- **후판**: 두꺼운 강판", parent)
      b = human_file("- **MES**: 제조", project)
      ra1 = registrar.register(cand("우판", "후판"))
      ra2 = registrar.register(cand("후 반", "후판"))
      rnew = registrar.register(cand("엠이", "MES"))
      expect(rnew[:domain_file]).to eq(b)
      rc = registrar.register(cand("디엠이에스", "DMES"))
      expect(rc[:domain_file]).to eq(SttTermLearning::AutoDomainFile.find_for(SttTermLearning::Level.for(child)))
      a.update_column(:content, "- **후판**: 두꺼운 강판\n" + "x" * (DomainFile::MAX_CONTENT_CHARS - 20))
      expect { registrar.flush! }.not_to raise_error
      [ ra1, ra2 ].each { |r| expect(r).to include(verdict: "skipped_invalid", reason: "file_full", change: nil) }
      expect(rnew[:verdict]).to eq("merged_existing")
      expect(rc[:verdict]).to eq("registered")
      expect(rc[:change]["line"]).to eq("- **DMES** [STT] (오인식: 디엠이에스): ")
      expect(a.reload.content).to start_with("- **후판**: 두꺼운 강판\n")
      expect(b.reload.content).to eq("- **MES** (오인식: 엠이): 제조")
    end

    it "사람 파일 병합도 한도를 넘기면 file_full" do
      human = human_file("- **후판**: 두꺼운 강판\n" + "x" * (DomainFile::MAX_CONTENT_CHARS - 30), parent)
      r = registrar.register(cand("우판우판우판우판", "후판")); registrar.flush!
      expect(r).to include(verdict: "skipped_invalid", reason: "file_full")
      expect(human.reload.content).to start_with("- **후판**: 두꺼운 강판\n")
    end
  end

  it "도메인 파일 쓰기는 트랜잭션 안에서 하고 오류 시 롤백된다" do
    human = human_file("- **후판**: 두꺼운 강판", parent)
    other = human_file("- **MES**: 제조", project)
    registrar.register(cand("우판", "후판"))
    registrar.register(cand("엠이에스", "MES"))
    allow_any_instance_of(DomainFile).to receive(:apply_learning!).and_wrap_original do |m, **kw|
      raise ActiveRecord::StatementInvalid, "boom" if m.receiver.id == other.id
      m.call(**kw)
    end
    expect { registrar.flush! }.to raise_error(ActiveRecord::StatementInvalid)
    expect(human.reload.content).to eq("- **후판**: 두꺼운 강판")
    expect(other.reload.content).to eq("- **MES**: 제조")
  end
end
