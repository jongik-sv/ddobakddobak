require "rails_helper"

RSpec.describe SttTermLearning::TermMover do
  let(:actor) { create(:user) }
  let(:project) { create(:project) }
  let(:folder) { create(:folder, project: project) }
  let(:level) { SttTermLearning::Level }
  let(:auto) { SttTermLearning::AutoDomainFile }
  let(:mover) { described_class.new(actor: actor) }
  let(:folder_file) do
    f = auto.find_or_create_for!(level.for(folder), fallback_creator: actor)
    f.update!(content: "- **후판** [STT] (오인식: 우판): 두꺼운 강판\n- **냉연**: 냉간압연")
    f
  end

  def move(file, keys, target, **opts)
    { domain_file_id: file.id, term_keys: keys, target: target, copy: false, merge_descendants: false }.merge(opts)
  end

  it "폴더 자동 파일의 줄을 프로젝트로 올리면 원 줄 삭제 + 프로젝트 자동 파일 생성·링크 + 새 줄" do
    result = mover.apply!([move(folder_file, ["후판"], level.for(project))])
    expect(result).to eq(moved: 1, merged: 0)
    expect(folder_file.reload.find_term("후판")).to be_nil
    expect(folder_file.find_term("냉연")).to be_present
    target = auto.find_for(level.for(project))
    expect(project.domain_files).to include(target)
    t = target.find_term("후판")
    expect([t[:term], t[:category], t[:definition], t[:mispronunciations]]).to eq(["후판", "STT", "두꺼운 강판", ["우판"]])
  end

  it "대상에 같은 용어가 있으면 오인식만 합집합(대상 정의 보존), merged=1" do
    target = auto.find_or_create_for!(level.for(project), fallback_creator: actor)
    target.update!(content: "- **후판** [조달] (오인식: 후핀): 대상 정의")
    result = mover.apply!([move(folder_file, ["후판"], level.for(project))])
    expect(result).to eq(moved: 1, merged: 1)
    t = target.reload.find_term("후판")
    expect([t[:category], t[:definition], t[:mispronunciations]]).to eq(["조달", "대상 정의", %w[후핀 우판]])
    expect(folder_file.reload.find_term("후판")).to be_nil
  end

  it "copy: true 면 원 줄 유지" do
    mover.apply!([move(folder_file, ["후판"], level.for(project), copy: true)])
    expect(folder_file.reload.find_term("후판")).to be_present
    expect(auto.find_for(level.for(project)).find_term("후판")).to be_present
  end

  it "사람 작성 파일 줄을 옮기면 그 줄만 원 파일에서 빠지고 나머지 내용·자유 텍스트 보존" do
    human = create(:domain_file, project: project, content: "# 제목\n- **MES** [시스템] (오인식: 엠에스): 제조실행\n메모 텍스트\n- **ERP**: 전사자원")
    mover.apply!([move(human, ["mes"], level.global)])
    expect(human.reload.content).to eq("# 제목\n메모 텍스트\n- **ERP**: 전사자원")
    t = auto.find_for(level.global).find_term("mes")
    expect([t[:term], t[:category], t[:definition], t[:mispronunciations]]).to eq(["MES", "시스템", "제조실행", ["엠에스"]])
  end

  it "merge_descendants: 하위 폴더 2곳의 같은 용어를 지우고 오인식을 대상 줄에 모은다" do
    c1 = create(:folder, project: project, parent: folder)
    c2 = create(:folder, project: project, parent: folder)
    f1 = auto.find_or_create_for!(level.for(c1), fallback_creator: actor)
    f2 = auto.find_or_create_for!(level.for(c2), fallback_creator: actor)
    f1.update!(content: "- **후판** (오인식: 후핀): 정의1\n- **다른**: d")
    f2.update!(content: "- **후판** (오인식: 후파인): 정의2")
    src = auto.find_or_create_for!(level.for(project), fallback_creator: actor)
    src.update!(content: "- **후판** (오인식: 우판): 상위 정의")
    mover.apply!([move(src, ["후판"], level.for(folder), merge_descendants: true)])
    expect(f1.reload.find_term("후판")).to be_nil
    expect(f1.find_term("다른")).to be_present
    expect(f2.reload.find_term("후판")).to be_nil
    t = auto.find_for(level.for(folder)).find_term("후판")
    expect(t[:mispronunciations]).to match_array(%w[우판 후핀 후파인])
  end

  context "merge_descendants 안전장치" do
    let(:src) do
      f = auto.find_or_create_for!(level.for(project), fallback_creator: actor)
      f.update!(content: "- **후판** (오인식: 우판): 상위")
      f
    end
    let(:child) { create(:folder, project: project, parent: folder) }

    it "사람 작성 하위 파일은 건드리지 않는다" do
      human = create(:domain_file, project: project, content: "- **후판** (오인식: 후핀): 사람")
      DomainFileLink.create!(domain_file: human, owner: child)
      mover.apply!([move(src, ["후판"], level.for(folder), merge_descendants: true)])
      expect(human.reload.content).to eq("- **후판** (오인식: 후핀): 사람")
    end

    it "남의 개인 프로젝트 레벨은 건너뛴다" do
      personal = create(:project, personal: true, created_by_id: create(:user).id)
      pf = create(:folder, project: personal)
      pa = auto.find_or_create_for!(level.for(pf), fallback_creator: actor)
      pa.update!(content: "- **후판** (오인식: 후핀): x")
      mover.apply!([move(src, ["후판"], level.global, merge_descendants: true)])
      expect(pa.reload.find_term("후판")).to be_present
    end

    it "지운 줄을 결과 로그에 기록한다" do
      ca = auto.find_or_create_for!(level.for(child), fallback_creator: actor)
      ca.update!(content: "- **후판** (오인식: 후핀): c")
      mover.apply!([move(src, ["후판"], level.for(folder), merge_descendants: true)])
      removed = JSON.parse(SttTermMoveLog.last.result)["removed_lines"]
      expect(removed).to eq([{ "file_id" => ca.id, "line" => "- **후판** (오인식: 후핀): c" }])
    end

    it "중간 실패 시 전부 롤백" do
      c1 = auto.find_or_create_for!(level.for(child), fallback_creator: actor)
      c1.update!(content: "- **후판** (오인식: 후핀): c")
      allow_any_instance_of(DomainFile).to receive(:remove_term_line!).and_wrap_original do |orig, *args|
        raise ActiveRecord::ActiveRecordError, "boom" if orig.receiver.id == c1.id
        orig.call(*args)
      end
      expect {
        mover.apply!([move(src, ["후판"], level.for(folder), merge_descendants: true)])
      }.to raise_error(described_class::Error)
      expect(src.reload.find_term("후판")).to be_present
      expect(c1.reload.find_term("후판")).to be_present
      expect(auto.find_for(level.for(folder))).to be_nil
    end
  end

  it "term_keys nil 이고 중복 key 줄이면 원본에서 전부 제거" do
    folder_file.update!(content: "- **후판** (오인식: 우판): a\n- **후판** (오인식: 후핀): b")
    mover.apply!([move(folder_file, nil, level.for(project))])
    expect(folder_file.reload.find_term("후판")).to be_nil
    expect(auto.find_for(level.for(project)).find_term("후판")[:mispronunciations]).to match_array(%w[우판 후핀])
  end

  it "keys 가 비면 자동 파일을 만들지 않는다" do
    folder_file.update!(content: "메모만")
    expect(mover.apply!([move(folder_file, nil, level.for(project))])).to eq(moved: 0, merged: 0)
    expect(auto.find_for(level.for(project))).to be_nil
  end

  it "copy 문자열 false 는 false" do
    mover.apply!([move(folder_file, ["후판"], level.for(project), copy: "false")])
    expect(folder_file.reload.find_term("후판")).to be_nil
  end

  it "term_keys nil 이면 파일의 용어 줄 전부(자유 텍스트는 남김)" do
    folder_file.update!(content: "메모\n- **후판**: a\n- **냉연**: b")
    result = mover.apply!([move(folder_file, nil, level.for(project))])
    expect(result[:moved]).to eq(2)
    expect(folder_file.reload.content).to eq("메모")
  end

  it "여러 move 중 하나가 실패(없는 key)하면 전부 롤백하고 Error" do
    expect {
      mover.apply!([move(folder_file, ["후판"], level.for(project)), move(folder_file, ["없음"], level.for(project))])
    }.to raise_error(described_class::Error)
    expect(folder_file.reload.find_term("후판")).to be_present
    expect(auto.find_for(level.for(project))).to be_nil
    expect(SttTermMoveLog.count).to eq(0)
  end

  it "이동 감사 로그를 남긴다" do
    mover.apply!([move(folder_file, ["후판"], level.for(project))])
    log = SttTermMoveLog.last
    expect(log.actor).to eq(actor)
    expect(JSON.parse(log.moves).first).to include("domain_file_id" => folder_file.id, "term_keys" => ["후판"],
                                                   "target" => { "type" => "Project", "id" => project.id })
    expect(JSON.parse(log.result)).to include("moved" => 1, "merged" => 0)
  end

  it "delete! 는 줄을 지우고 로그를 남긴다" do
    n = mover.delete!([{ domain_file_id: folder_file.id, term_key: "냉연" }])
    expect(n).to eq(1)
    expect(folder_file.reload.find_term("냉연")).to be_nil
    expect(SttTermMoveLog.count).to eq(1)
    expect {
      mover.delete!([{ domain_file_id: folder_file.id, term_key: "후판" }, { domain_file_id: folder_file.id, term_key: "없음" }])
    }.to raise_error(described_class::Error)
    expect(folder_file.reload.find_term("후판")).to be_present
  end
end
