require "rails_helper"

RSpec.describe Folder, "#subtree_ids" do
  let(:project) { create(:project) }

  it "자신 + 모든 자손 폴더 id (루트 포함)" do
    root = create(:folder, project: project)
    child = create(:folder, project: project, parent: root)
    grandchild = create(:folder, project: project, parent: child)
    sibling = create(:folder, project: project) # 무관 폴더
    expect(root.subtree_ids).to match_array([root.id, child.id, grandchild.id])
    expect(root.subtree_ids).not_to include(sibling.id)
  end

  it "자식 없으면 자신만" do
    leaf = create(:folder, project: project)
    expect(leaf.subtree_ids).to eq([leaf.id])
  end

  it "사이클이 있어도 무한루프 없이 종료" do
    a = create(:folder, project: project)
    b = create(:folder, project: project, parent: a)
    a.update_column(:parent_id, b.id) # a<->b 사이클
    expect(a.subtree_ids).to match_array([a.id, b.id])
  end
end
