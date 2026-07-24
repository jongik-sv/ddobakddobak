require "rails_helper"

# Meeting#editable_by? — idea 44: 소유자/admin 외에 직접 지정 협업자·폴더 상속 협업자도 편집 가능.
RSpec.describe Meeting, "#editable_by?" do
  let(:owner)  { create(:user) }
  let(:other)  { create(:user) }
  let(:admin)  { create(:user, :admin) }
  let(:collaborator) { create(:user) }
  let(:root)   { create(:folder) }
  let(:mid)    { create(:folder, parent: root) }
  let(:leaf)   { create(:folder, parent: mid) }
  let(:meeting) { create(:meeting, creator: owner) }

  it "소유자는 true (기존 유지)" do
    expect(meeting.editable_by?(owner)).to be true
  end

  it "admin은 true (기존 유지)" do
    expect(meeting.editable_by?(admin)).to be true
  end

  it "직접 지정 협업자(MeetingCollaborator)는 true" do
    MeetingCollaborator.create!(meeting: meeting, user: collaborator)
    expect(meeting.editable_by?(collaborator)).to be true
  end

  it "소속 폴더의 협업자(직속)는 true" do
    m = create(:meeting, creator: owner, folder: leaf)
    FolderCollaborator.create!(folder: leaf, user: collaborator)
    expect(m.editable_by?(collaborator)).to be true
  end

  it "조상 폴더의 협업자(2단계 이상)는 true" do
    m = create(:meeting, creator: owner, folder: leaf)
    FolderCollaborator.create!(folder: root, user: collaborator)
    expect(m.editable_by?(collaborator)).to be true
  end

  it "무관한 사용자는 false" do
    expect(meeting.editable_by?(other)).to be false
  end

  it "user가 nil이면 false" do
    expect(meeting.editable_by?(nil)).to be false
  end
end
