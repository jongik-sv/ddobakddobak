require "rails_helper"

RSpec.describe Folder, "#editable_by? / #ancestor_records" do
  let(:owner)   { create(:user) }
  let(:other)   { create(:user) }
  let(:admin)   { create(:user, :admin) }
  let(:root)    { create(:folder) }
  let(:mid)     { create(:folder, parent: root) }
  let(:leaf)    { create(:folder, parent: mid) }

  describe "#editable_by?" do
    before { create(:meeting, creator: owner, folder_id: leaf.id) }

    it "admin은 항상 편집 가능" do
      expect(leaf.editable_by?(admin)).to be true
    end

    it "폴더 직속 회의 creator는 편집 가능" do
      expect(leaf.editable_by?(owner)).to be true
    end

    it "무관한 사용자는 편집 불가" do
      expect(leaf.editable_by?(other)).to be false
    end
  end

  describe "#ancestor_records" do
    it "가까운→먼 순서의 조상 레코드를 반환" do
      expect(leaf.ancestor_records.map(&:id)).to eq([mid.id, root.id])
    end

    it "루트 폴더는 빈 배열" do
      expect(root.ancestor_records).to eq([])
    end
  end
end
