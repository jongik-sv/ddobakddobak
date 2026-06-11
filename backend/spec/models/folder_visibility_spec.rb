require "rails_helper"

# 상위 폴더 비공개(shared=false) → 하위 폴더·회의 전부 가려짐(상속·폴더 우선) 검증.
RSpec.describe "Folder/Meeting 폴더 상속 가시성", type: :model do
  let(:owner) { create(:user) }
  let(:other) { create(:user) }
  let(:admin) { create(:user, :admin) }

  # parent(비공개) > child(공유) > meeting(공유)
  let!(:parent) { create(:folder, shared: false) }
  let!(:child)  { create(:folder, shared: true, parent: parent) }
  let!(:meeting) { create(:meeting, creator: owner, folder_id: child.id, shared: true) }

  describe "Folder#effectively_shared?" do
    it "조상이 비공개면 false (자신이 공유여도)" do
      expect(child.effectively_shared?).to be(false)
    end

    it "자신과 모든 조상이 공유면 true" do
      parent.update!(shared: true)
      expect(child.effectively_shared?).to be(true)
    end

    it "parent_id 사이클이 있어도 무한루프 없이 종료" do
      parent.update_column(:parent_id, child.id) # child > parent > child ...
      expect { child.effectively_shared? }.not_to raise_error
    end
  end

  describe "Folder.visible_folder_ids" do
    it "비공개 조상 하위 폴더 id는 제외" do
      expect(Folder.visible_folder_ids).not_to include(child.id, parent.id)
    end

    it "전 폴더가 공유면 모두 포함" do
      parent.update!(shared: true)
      expect(Folder.visible_folder_ids).to include(parent.id, child.id)
    end
  end

  describe "Meeting.accessible_by — 상속 가시성" do
    it "타인에겐 상위 비공개 하위 회의 안 보임" do
      expect(Meeting.accessible_by(other)).not_to include(meeting)
    end

    it "소유자에겐 본인 회의라 항상 보임" do
      expect(Meeting.accessible_by(owner)).to include(meeting)
    end

    it "admin에겐 전부 보임" do
      expect(Meeting.accessible_by(admin)).to include(meeting)
    end

    it "조상까지 공유로 풀면 타인도 보임" do
      parent.update!(shared: true)
      expect(Meeting.accessible_by(other)).to include(meeting)
    end

    it "폴더 없는 공유 회의는 보임(빈 visible_folder_ids 케이스 포함)" do
      folderless = create(:meeting, creator: owner, folder_id: nil, shared: true)
      expect(Meeting.accessible_by(other)).to include(folderless)
    end
  end

  describe "Meeting#shared_visible? — 단건 인가" do
    it "상위 비공개면 false" do
      expect(meeting.shared_visible?).to be(false)
    end

    it "조상까지 공유면 true" do
      parent.update!(shared: true)
      expect(meeting.reload.shared_visible?).to be(true)
    end
  end

  describe "Folder.tree — 비공개 서브트리 prune" do
    it "non-admin 트리엔 비공개 부모/하위 둘 다 없음" do
      ids = flatten_ids(Folder.tree(other))
      expect(ids).not_to include(parent.id, child.id)
    end

    it "admin 트리엔 자물쇠와 함께 전부 노출" do
      ids = flatten_ids(Folder.tree(admin))
      expect(ids).to include(parent.id, child.id)
    end

    it "전 폴더 공유면 non-admin도 전부 노출" do
      parent.update!(shared: true)
      ids = flatten_ids(Folder.tree(other))
      expect(ids).to include(parent.id, child.id)
    end
  end

  def flatten_ids(nodes)
    nodes.flat_map { |n| [n[:id]] + flatten_ids(n[:children]) }
  end
end
