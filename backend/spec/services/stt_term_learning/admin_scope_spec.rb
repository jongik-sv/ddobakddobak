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

  describe "서버 모드" do
    include_context "server mode"

    it "projects(user) 는 내가 admin 멤버인 살아 있는 팀 프로젝트만(시스템 admin 포함)" do
      me = create(:user, role: "admin")
      mine = create(:project, creator: me)
      team_member_only = create(:project, creator: me)
      trashed = create(:project, creator: me)
      create(:project_membership, project: mine, user: me, role: "admin")
      create(:project_membership, project: team_member_only, user: me, role: "member")
      create(:project_membership, project: trashed, user: me, role: "admin")
      trashed.update!(deleted_at: Time.current) if trashed.respond_to?(:deleted_at)
      expect(described_class.projects(me).to_a).to eq([ mine ]) if trashed.respond_to?(:deleted_at)
      expect(described_class.projects(me)).to include(mine)
      expect(described_class.projects(me)).not_to include(team_member_only)
      expect(described_class.manager?(me)).to be(true)
      expect(described_class.manager?(create(:user))).to be(false)
      expect(described_class.global_writer?(me)).to be(true)
      expect(described_class.global_writer?(create(:user))).to be(false)
    end

    it "Snapshot#hidden_meeting_ids 는 관리 프로젝트 밖 회의를 숨긴다" do
      me = create(:user)
      mine = create(:project, creator: me)
      other = create(:project, creator: me)
      create(:project_membership, project: mine, user: me, role: "admin")
      m1 = create(:meeting, project: mine, creator: me)
      m2 = create(:meeting, project: other, creator: me)
      snap = described_class::Snapshot.new(me)
      expect(snap.hidden_meeting_ids([ m1.id, m2.id ])).to eq(Set[m2.id])
    end
  end
end
