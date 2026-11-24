require "rails_helper"

RSpec.describe SttTermLearning::AdminScope do
  it "projects(user) 는 Project#blocks_admin_override? 와 같은 판정" do
    me = create(:user, role: "admin")
    other = create(:user)
    [create(:project, creator: me), create(:project, creator: other),
           create(:project, creator: me, personal: true), create(:project, creator: other, personal: true)]
    expected = Project.kept.to_a.reject { |p| p.blocks_admin_override?(me) }
    expect(described_class.projects(me).to_a).to match_array(expected)
  end

  describe "Snapshot project_id 필터" do
    it "그 프로젝트·폴더와 전역만 담고, 가시 프로젝트 집합은 유지한다" do
      me = create(:user, role: "admin")
      p1 = create(:project, creator: me)
      p2 = create(:project, creator: me)
      f1 = create(:folder, project: p1)
      create(:folder, project: p2)

      snap = described_class::Snapshot.new(me, project_id: p1.id)
      expect(snap.nodes.map(&:key)).to eq(["global", "Project:#{p1.id}", "Folder:#{f1.id}"])
      expect(snap.visible_project_ids).to include(p1.id, p2.id)
      expect(described_class::Snapshot.new(me).nodes.map(&:project_id).compact.uniq).to include(p1.id, p2.id)
    end
  end
end
