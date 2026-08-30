require "rails_helper"

# Meeting.ext_accessible_by — 세컨드 브레인 외부 API 열람 범위.
# = accessible_by(user) ∪ 직접 협업(meeting_collaborators) ∪ 폴더 상속 협업(folder_collaborators)
RSpec.describe Meeting, ".ext_accessible_by" do
  let(:owner)   { create(:user) }
  let(:member)  { create(:user) }   # 같은 프로젝트 멤버(공유 회의 열람 가능)
  let(:outsider) { create(:user) }  # 어떤 관계도 없는 사용자
  let(:admin)   { create(:user, :admin) }
  let(:project) { create(:project) }

  before do
    create(:project_membership, user: owner, project: project, role: "member")
    create(:project_membership, user: member, project: project, role: "member")
  end

  it "소유자는 본인 회의를 본다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    expect(Meeting.ext_accessible_by(owner)).to include(m)
  end

  it "같은 프로젝트 멤버는 공유 회의를 본다 (accessible_by 위임)" do
    m = create(:meeting, project: project, creator: owner, shared: true)
    expect(Meeting.ext_accessible_by(member)).to include(m)
  end

  it "같은 프로젝트 멤버라도 비공유 회의는 못 본다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    expect(Meeting.ext_accessible_by(member)).not_to include(m)
  end

  it "직접 협업자(MeetingCollaborator)는 비공유 회의도 본다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    MeetingCollaborator.create!(meeting: m, user: outsider)
    expect(Meeting.ext_accessible_by(outsider)).to include(m)
  end

  it "폴더 상속 협업자(조상 폴더의 FolderCollaborator)는 하위 회의를 본다" do
    root = create(:folder, project: project)
    leaf = create(:folder, project: project, parent: root)
    m = create(:meeting, project: project, creator: owner, folder: leaf, shared: false)
    FolderCollaborator.create!(folder: root, user: outsider)
    expect(Meeting.ext_accessible_by(outsider)).to include(m)
  end

  it "무관한 사용자는 격리된다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    expect(Meeting.ext_accessible_by(outsider)).not_to include(m)
  end

  it "휴지통(soft delete)된 회의는 협업 경로로도 노출되지 않는다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    MeetingCollaborator.create!(meeting: m, user: outsider)
    m.soft_delete!(by: owner, group: "g1")
    expect(Meeting.ext_accessible_by(outsider)).not_to include(m)
  end

  it "admin은 accessible_by와 동일하게 전체를 본다" do
    m = create(:meeting, project: project, creator: owner, shared: false)
    expect(Meeting.ext_accessible_by(admin)).to include(m)
  end
end
