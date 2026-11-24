require "rails_helper"

RSpec.describe SttTermLearning::LevelChain do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }

  it "for_meeting: 가까운 폴더 → 상위 폴더 → 프로젝트 → global" do
    meeting = create(:meeting, project: project, folder: child)
    expect(described_class.for_meeting(meeting).map(&:key))
      .to eq(["Folder:#{child.id}", "Folder:#{parent.id}", "Project:#{project.id}", "global"])
  end

  it "폴더 없는 회의는 [Project, global]" do
    meeting = create(:meeting, project: project)
    expect(described_class.for_meeting(meeting).map(&:key)).to eq(["Project:#{project.id}", "global"])
  end

  it "프로젝트·폴더 없으면 [global]" do
    meeting = instance_double(Meeting, folder: nil, project: nil)
    expect(described_class.for_meeting(meeting).map(&:key)).to eq(["global"])
  end

  it "upward_from" do
    expect(described_class.upward_from(SttTermLearning::Level.for(child)).map(&:key))
      .to eq(["Folder:#{child.id}", "Folder:#{parent.id}", "Project:#{project.id}", "global"])
  end
end

RSpec.describe SttTermLearning::Level do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }

  it "값 객체·key·ref·name·project_id" do
    l = described_class.for(child)
    expect(l.key).to eq("Folder:#{child.id}")
    expect(l.ref).to eq(type: "Folder", id: child.id)
    expect(l.name).to eq(child.name)
    expect(l.project_id).to eq(project.id)
    expect(described_class.global.ref).to eq(type: "global", id: nil)
    expect(described_class.global.key).to eq("global")
    expect(described_class.global.project_id).to be_nil
    expect(described_class.for(project)).to eq(described_class.from_ref(type: "Project", id: project.id))
    expect(described_class.from_ref(type: "global", id: nil)).to eq(described_class.global)
    expect { described_class.from_ref(type: "Folder", id: 0) }.to raise_error(ActiveRecord::RecordNotFound)
    expect { described_class.from_ref(type: "Bogus", id: 1) }.to raise_error(ActiveRecord::RecordNotFound)
  end

  it "parent" do
    expect(described_class.for(child).parent).to eq(described_class.for(parent))
    expect(described_class.for(parent).parent).to eq(described_class.for(project))
    expect(described_class.for(project).parent).to eq(described_class.global)
    expect(described_class.global.parent).to be_nil
  end

  it "descendant_levels 는 자신 제외·휴지통 폴더 제외" do
    trashed = create(:folder, project: project, parent: parent)
    trashed.soft_delete!(by: nil, group: SecureRandom.uuid, root: true)
    child
    expect(described_class.for(parent).descendant_levels.map(&:key)).to eq(["Folder:#{child.id}"])
    expect(described_class.for(project).descendant_levels.map(&:key)).to match_array(["Folder:#{parent.id}", "Folder:#{child.id}"])
    keys = described_class.global.descendant_levels.map(&:key)
    expect(keys).to include("Project:#{project.id}", "Folder:#{parent.id}", "Folder:#{child.id}")
    expect(keys).not_to include("Folder:#{trashed.id}", "global")
  end

  it "linked_files" do
    a = create(:domain_file)
    b = create(:domain_file)
    DomainFileLink.create!(domain_file: b, owner: project)
    DomainFileLink.create!(domain_file: a, owner: project)
    expect(described_class.for(project).linked_files).to eq([b, a])
    g = create(:domain_file, auto_kind: "stt_auto", name: "g")
    expect(described_class.global.linked_files).to eq([g])
  end
end
