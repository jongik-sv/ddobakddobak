require "rails_helper"

RSpec.describe ProjectInvite, type: :model do
  let(:project) { create(:project) }

  describe ".generate!" do
    it "6자 영숫자 코드를 만든다" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator)
      expect(invite.code).to match(/\A[a-zA-Z0-9]{6}\z/)
    end
  end

  describe "#redeemable?" do
    it "만료·횟수 제한 없으면 true" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator)
      expect(invite.redeemable?).to be true
    end

    it "만료되면 false" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator, expires_at: 1.hour.ago)
      expect(invite.redeemable?).to be false
    end

    it "최대 횟수 도달하면 false" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator, max_uses: 1)
      invite.update!(use_count: 1)
      expect(invite.redeemable?).to be false
    end
  end

  describe "#consume!" do
    it "use_count를 1 증가시킨다" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator)
      expect { invite.consume! }.to change { invite.reload.use_count }.by(1)
    end
  end
end
