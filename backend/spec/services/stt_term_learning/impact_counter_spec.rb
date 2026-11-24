require "rails_helper"

RSpec.describe SttTermLearning::ImpactCounter do
  let(:project) { create(:project) }
  let(:parent) { create(:folder, project: project) }
  let(:child) { create(:folder, project: project, parent: parent) }
  let(:level) { SttTermLearning::Level }

  it "폴더는 서브트리 회의 수, 휴지통 회의 제외" do
    create(:meeting, project: project, folder: parent)
    create(:meeting, project: project, folder: child)
    create(:meeting, project: project)
    trashed = create(:meeting, project: project, folder: child)
    trashed.update_columns(deleted_at: Time.current)
    expect(described_class.count(level.for(parent))).to eq(2)
    expect(described_class.count(level.for(child))).to eq(1)
  end

  it "휴지통 하위 폴더 안의 회의는 세지 않는다" do
    create(:meeting, project: project, folder: parent)
    create(:meeting, project: project, folder: child)
    child.update_columns(deleted_at: Time.current)
    expect(described_class.count(level.for(parent))).to eq(1)
  end

  it "프로젝트는 그 프로젝트 회의 수" do
    create(:meeting, project: project)
    create(:meeting, project: create(:project))
    expect(described_class.count(level.for(project))).to eq(1)
  end

  it "그 파일을 exclude 한 회의는 빼고 센다" do
    m1 = create(:meeting, project: project, folder: parent)
    create(:meeting, project: project, folder: parent)
    file = create(:domain_file)
    DomainFileLink.create!(domain_file: file, owner: m1, exclude: true)
    expect(described_class.count(level.for(parent))).to eq(2)
    expect(described_class.count(level.for(parent), domain_file_id: file.id)).to eq(1)
  end

  it "global 은 전체 kept 회의" do
    create(:meeting, project: project)
    create(:meeting)
    expect(described_class.count(level.global)).to eq(Meeting.kept.count)
    expect(described_class.count(level.global)).to eq(2)
  end
end
