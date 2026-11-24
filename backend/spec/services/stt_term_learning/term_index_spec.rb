require "rails_helper"

RSpec.describe SttTermLearning::TermIndex do
  let(:admin) { create(:user, role: "admin") }
  let(:project) { create(:project, creator: admin) }
  let(:parent) { create(:folder, project: project) }
  let(:a) { create(:folder, project: project, parent: parent) }
  let(:b) { create(:folder, project: project, parent: parent) }
  let(:level) { SttTermLearning::Level }
  let(:auto) { SttTermLearning::AutoDomainFile }
  let(:index) { described_class.new(admin) }

  def file_for(lv, content)
    f = auto.find_or_create_for!(lv, fallback_creator: admin)
    f.update!(content: content)
    f
  end

  def item(file, key: "후판", source: "llm_diff", verdict: "registered", status: "done", finished: 1.day.ago, meeting: nil)
    run = create(:stt_term_learning_run, status: status, finished_at: finished, meeting: meeting || create(:meeting, project: project))
    create(:stt_term_learning_item, run: run, domain_file: file, correct_key: key, source: source, verdict: verdict)
  end

  it "rows: 자동 파일 줄 source auto/feedback, meeting_ids, 필드" do
    f1 = file_for(level.for(a), "- **후판** [STT] (오인식: 우판): 두꺼운 강판\n- **냉연**: y\n- **산세**: z")
    i1 = item(f1, key: "후판", source: "feedback")
    item(f1, key: "냉연", source: "llm_diff")
    rows = index.rows(level: level.for(a)).to_h { |r| [r["key"], r] }
    r = rows["후판"]
    expect(r).to include("row_id" => "#{f1.id}:후판@Folder:#{a.id}", "term" => "후판", "category" => "STT", "definition" => "두꺼운 강판",
                         "mispronunciations" => ["우판"], "source" => "feedback", "is_new" => true)
    expect(r["meeting_ids"]).to eq([i1.run.meeting_id])
    expect(r["domain_file"]).to eq("id" => f1.id, "name" => f1.name, "auto" => true)
    expect(r["level"]).to include("type" => "Folder", "id" => a.id, "path" => [project.name, parent.name, a.name])
    expect(rows["냉연"]["source"]).to eq("auto")
    expect(rows["산세"]).to include("source" => "auto", "meeting_ids" => [], "is_new" => false)
  end

  it "rows: 사람 파일 human / human_merged" do
    human = create(:domain_file, project: project, creator: admin, content: "- **MES** [시스템] (발음: 엠에스): 제조\n- **ERP**: e")
    DomainFileLink.create!(domain_file: human, owner: project)
    item(human, key: "mes", verdict: "merged_existing")
    rows = index.rows(level: level.for(project)).to_h { |r| [r["key"], r] }
    expect(rows["mes"]).to include("source" => "human_merged", "domain_file" => { "id" => human.id, "name" => human.name, "auto" => false })
    expect(rows["erp"]["source"]).to eq("human")
  end

  it "include_descendants: 하위 폴더 줄 포함, 기본은 미포함" do
    file_for(level.for(parent), "- **p**: 1")
    file_for(level.for(a), "- **x**: 1")
    expect(index.rows(level: level.for(parent)).map { |r| r["key"] }).to eq(["p"])
    expect(index.rows(level: level.for(parent), include_descendants: true).map { |r| r["key"] }).to contain_exactly("p", "x")
  end

  it "level nil 이면 전 레벨(전역 포함)" do
    file_for(level.global, "- **g**: 1")
    file_for(level.for(a), "- **x**: 1")
    expect(index.rows.map { |r| r["key"] }).to contain_exactly("g", "x")
  end

  it "두 폴더에 같은 key → 같은 duplicate_group, merge_target 은 공통 부모 폴더" do
    file_for(level.for(a), "- **후판**: 1")
    file_for(level.for(b), "- **후판**: 1")
    file_for(level.for(project), "- **냉연**: 1")
    rows = index.rows(level: level.for(project), include_descendants: true)
    dup = rows.select { |r| r["key"] == "후판" }
    expect(dup.map { |r| r["duplicate_group"] }.uniq).to eq(["#{project.id}:후판"])
    expect(dup.map { |r| r["merge_target"] }.uniq).to eq([{ "type" => "Folder", "id" => parent.id, "name" => parent.name,
                                                             "path" => [project.name, parent.name] }])
    expect(rows.find { |r| r["key"] == "냉연" }).to include("duplicate_group" => nil, "merge_target" => nil)
  end

  it "다른 프로젝트·전역의 같은 key 는 그룹이 아니다" do
    other = create(:project, creator: admin)
    file_for(level.for(a), "- **후판**: 1")
    file_for(level.for(other), "- **후판**: 1")
    file_for(level.global, "- **후판**: 1")
    expect(index.rows.map { |r| r["duplicate_group"] }.uniq).to eq([nil])
  end

  it "프로젝트와 폴더에 같은 key → merge_target 은 프로젝트(멤버가 거기 있어 승격 후보는 아님)" do
    file_for(level.for(project), "- **후판**: 1")
    file_for(level.for(a), "- **후판**: 1")
    rows = index.rows
    expect(rows.map { |r| r["merge_target"]&.dig("type") }.uniq).to eq(["Project"])
    snap = SttTermLearning::AdminScope.snapshot(admin)
    expect(snap.groups.values.map { |g| g[:promote] }).to eq([false])
  end

  it "reverted run 의 item 은 source·meeting_ids·is_new 에서 제외" do
    f = file_for(level.for(a), "- **후판**: 1")
    item(f, source: "feedback", status: "reverted")
    live = item(f, source: "llm_diff")
    r = index.rows(level: level.for(a)).first
    expect(r["source"]).to eq("auto")
    expect(r["meeting_ids"]).to eq([live.run.meeting_id])
  end

  it "남의 personal 프로젝트는 terms 에서 빠진다" do
    personal = create(:project, personal: true, creator: create(:user))
    file_for(level.for(personal), "- **비밀**: 1")
    expect(index.rows.map { |r| r["key"] }).not_to include("비밀")
    expect(index.rows(level: level.for(personal))).to eq([])
  end

  it "applied_meeting_count 는 ImpactCounter 값" do
    f = file_for(level.for(a), "- **후판**: 1")
    create(:meeting, project: project, folder: a)
    create(:meeting, project: project, folder: a)
    expect(index.rows(level: level.for(a)).first["applied_meeting_count"]).to eq(SttTermLearning::ImpactCounter.count(level.for(a), domain_file_id: f.id))
  end

  it "한 사람 파일이 프로젝트·폴더에 링크 → row_id 구분, 중복 그룹·승격 후보 아님" do
    human = create(:domain_file, project: project, creator: admin, content: "- **MES**: 제조")
    DomainFileLink.create!(domain_file: human, owner: project)
    DomainFileLink.create!(domain_file: human, owner: a)
    rows = index.rows.select { |r| r["key"] == "mes" }
    expect(rows.map { |r| r["row_id"] }).to contain_exactly("#{human.id}:mes@Project:#{project.id}", "#{human.id}:mes@Folder:#{a.id}")
    expect(rows.map { |r| r["duplicate_group"] }).to eq([nil, nil])
    expect(SttTermLearning::AdminScope.snapshot(admin).groups).to be_empty
  end

  it "서로 다른 파일의 같은 key 는 형제 폴더에서 여전히 그룹" do
    file_for(level.for(a), "- **후판**: 1")
    file_for(level.for(b), "- **후판**: 1")
    expect(SttTermLearning::AdminScope.snapshot(admin).groups.size).to eq(1)
  end

  it "보이지 않는 프로젝트 회의는 meeting_ids 에서 제외" do
    f = file_for(level.for(a), "- **후판**: 1")
    hidden_project = create(:project, personal: true, creator: create(:user))
    hidden = create(:meeting, project: project)
    hidden.update_columns(project_id: hidden_project.id)
    visible = item(f)
    item(f, meeting: hidden)
    expect(index.rows(level: level.for(a)).first["meeting_ids"]).to eq([visible.run.meeting_id])
  end
end
