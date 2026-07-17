require "rails_helper"

RSpec.describe ProjectMembership, type: :model do
  describe "개인 프로젝트 멤버 추가 방지 (모델 최후 방어선)" do
    it "개인 프로젝트 + creator 본인 멤버십은 valid" do
      creator = create(:user)
      project = create(:project, creator: creator, personal: true)
      membership = build(:project_membership, project: project, user: creator, role: "admin")

      expect(membership).to be_valid
    end

    it "개인 프로젝트 + 타인 멤버십은 invalid" do
      creator = create(:user)
      other = create(:user)
      project = create(:project, creator: creator, personal: true)
      membership = build(:project_membership, project: project, user: other, role: "member")

      expect(membership).not_to be_valid
      expect(membership.errors[:user_id]).to be_present
    end

    it "팀(비개인) 프로젝트 + 타인 멤버십은 valid" do
      creator = create(:user)
      other = create(:user)
      project = create(:project, creator: creator, personal: false)
      membership = build(:project_membership, project: project, user: other, role: "member")

      expect(membership).to be_valid
    end
  end
end
