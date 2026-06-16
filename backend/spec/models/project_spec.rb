require "rails_helper"

RSpec.describe Project, type: :model do
  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }

    it "icon_type을 lucide/emoji/image로 제한한다" do
      expect(build(:project, icon_type: "lucide")).to be_valid
      expect(build(:project, icon_type: "bogus")).not_to be_valid
      expect(build(:project, icon_type: nil)).to be_valid
    end
  end

  describe "#deletable?" do
    let(:project) { create(:project) }

    it "회의·폴더가 없으면 true" do
      expect(project.deletable?).to be true
    end

    it "회의가 있으면 false" do
      create(:meeting, project: project, creator: project.creator)
      expect(project.deletable?).to be false
    end

    it "폴더가 있으면 false" do
      create(:folder, project: project)
      expect(project.deletable?).to be false
    end

    it "개인 프로젝트는 비어 있어도 false" do
      personal = create(:project, personal: true)
      expect(personal.deletable?).to be false
    end
  end

  describe "#admin?" do
    it "해당 유저의 멤버십 role이 admin이면 true" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "admin")
      expect(project.admin?(user)).to be true
    end

    it "member면 false" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "member")
      expect(project.admin?(user)).to be false
    end
  end
end
