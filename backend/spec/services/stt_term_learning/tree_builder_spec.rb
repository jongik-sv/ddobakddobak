require "rails_helper"

RSpec.describe SttTermLearning::TreeBuilder do
  let(:admin) { create(:user, role: "admin") }
  let(:project) { create(:project, creator: admin) }
  let(:parent) { create(:folder, project: project) }
  let(:a) { create(:folder, project: project, parent: parent) }
  let(:b) { create(:folder, project: project, parent: parent) }
  let(:level) { SttTermLearning::Level }
  let(:auto) { SttTermLearning::AutoDomainFile }

  def file_for(lv, content)
    f = auto.find_or_create_for!(lv, fallback_creator: admin)
    f.update!(content: content)
    f
  end

  it "tree: 전역·프로젝트·폴더(parent_id 포함) 노드와 term_count" do
    file_for(level.global, "- **후판**: x\n- **냉연**: y")
    file_for(level.for(project), "- **MES**: z")
    file_for(level.for(a), "- **산세**: q")
    tree = described_class.new(admin).call
    expect(tree["global"]).to eq("term_count" => 2, "new_count" => 0)
    p = tree["projects"].find { |x| x["id"] == project.id }
    expect(p["term_count"]).to eq(1)
    folders = p["folders"].to_h { |f| [f["id"], f] }
    expect(folders[parent.id]["parent_id"]).to be_nil
    expect(folders[a.id]["parent_id"]).to eq(parent.id)
    expect(folders[a.id]["term_count"]).to eq(1)
  end

  it "남의 personal 프로젝트는 빠진다" do
    project
    other = create(:user)
    personal = create(:project, personal: true, creator: other)
    mine = create(:project, personal: true, creator: admin)
    ids = described_class.new(admin).call["projects"].map { |x| x["id"] }
    expect(ids).to include(mine.id, project.id)
    expect(ids).not_to include(personal.id)
  end

  it "형제 폴더 두 곳에 같은 용어 → 부모 레벨 promote_candidates" do
    file_for(level.for(a), "- **후판**: x")
    file_for(level.for(b), "- **후판**: x")
    p = described_class.new(admin).call["projects"].find { |x| x["id"] == project.id }
    parent_node = p["folders"].find { |f| f["id"] == parent.id }
    expect(parent_node["promote_candidates"]).to eq([{ "term" => "후판", "folder_ids" => [a.id, b.id] }])
    expect(p["promote_candidates"]).to eq([])
  end

  it "부모 레벨에 이미 있으면 후보가 아니다" do
    file_for(level.for(a), "- **후판**: x")
    file_for(level.for(b), "- **후판**: x")
    file_for(level.for(parent), "- **후판**: x")
    p = described_class.new(admin).call["projects"].find { |x| x["id"] == project.id }
    expect(p["folders"].find { |f| f["id"] == parent.id }["promote_candidates"]).to eq([])
  end

  it "new_count: 7일 내 끝난 non-reverted run 의 registered 만" do
    f = file_for(level.for(a), "- **후판**: x")
    mk = lambda do |status, finished, verdict|
      run = create(:stt_term_learning_run, status: status, finished_at: finished)
      create(:stt_term_learning_item, run: run, domain_file: f, verdict: verdict)
    end
    mk.call("done", 1.day.ago, "registered")
    mk.call("done", 1.day.ago, "merged_existing")
    mk.call("done", 8.days.ago, "registered")
    mk.call("reverted", 1.day.ago, "registered")
    folder = described_class.new(admin).call["projects"].find { |x| x["id"] == project.id }["folders"].find { |x| x["id"] == a.id }
    expect(folder["new_count"]).to eq(1)
  end
end
