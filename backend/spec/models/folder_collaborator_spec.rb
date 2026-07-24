require "rails_helper"

# Folder#collaborator? — idea 44: 이 폴더 밑 회의들에 상속되는 협업자인지(폴더 자체 편집권 editable_by?와는 다른 개념).
RSpec.describe Folder, "#collaborator?" do
  let(:collaborator) { create(:user) }
  let(:other)  { create(:user) }
  let(:root)   { create(:folder) }
  let(:mid)    { create(:folder, parent: root) }
  let(:leaf)   { create(:folder, parent: mid) }

  it "자신에게 직접 지정된 협업자는 true" do
    FolderCollaborator.create!(folder: leaf, user: collaborator)
    expect(leaf.collaborator?(collaborator)).to be true
  end

  it "조상 폴더 협업자는 true(다단계)" do
    FolderCollaborator.create!(folder: root, user: collaborator)
    expect(leaf.collaborator?(collaborator)).to be true
  end

  it "무관한 사용자는 false" do
    FolderCollaborator.create!(folder: leaf, user: collaborator)
    expect(leaf.collaborator?(other)).to be false
  end

  it "user가 nil이면 false" do
    expect(leaf.collaborator?(nil)).to be false
  end

  it "사이클(parent_id 순환)이 있어도 무한루프 없이 종료" do
    a = create(:folder)
    b = create(:folder, parent: a)
    a.update_column(:parent_id, b.id) # 강제 사이클 (update! 은 부모연쇄 검증 없음, update_column 로 직접 DB 조작)
    FolderCollaborator.create!(folder: a, user: collaborator)
    expect { b.reload.collaborator?(other) }.not_to raise_error
  end
end
