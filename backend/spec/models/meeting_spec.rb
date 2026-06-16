require "rails_helper"

RSpec.describe Meeting, type: :model do
  describe "#locked?" do
    it "is false when locked_at is nil" do
      meeting = build(:meeting, locked_at: nil)
      expect(meeting.locked?).to be false
    end

    it "is true when locked_at is present" do
      meeting = build(:meeting, locked_at: Time.current)
      expect(meeting.locked?).to be true
    end
  end

  describe "importance inheritance from folder (before_create)" do
    # 팩토리 기본은 important_explicitly_set=true(요청/목록 레이어 편의)라 상속 콜백을 건너뛴다.
    # 콜백 자체를 검증하는 아래 케이스들은 명시 플래그를 끄고(=false) 순수 상속 경로를 태운다.
    it "inherits important=true from a folder with important=true" do
      folder = create(:folder, important: true)
      meeting = create(:meeting, folder: folder, important_explicitly_set: false)
      expect(meeting.important).to be true
    end

    it "inherits important=false from a folder with important=false" do
      folder = create(:folder, important: false)
      meeting = create(:meeting, folder: folder, important_explicitly_set: false)
      expect(meeting.important).to be false
    end

    it "is false when the meeting has no folder" do
      meeting = create(:meeting, folder: nil, important_explicitly_set: false)
      expect(meeting.important).to be false
    end

    it "does not inherit and preserves the given value when important_explicitly_set is true" do
      folder = create(:folder, important: true)
      meeting = build(:meeting, folder: folder, important: false)
      meeting.important_explicitly_set = true
      meeting.save!
      expect(meeting.important).to be false
    end
  end

  describe ".accessible_by 프로젝트 격리" do
    let(:user)  { create(:user) }
    let(:p1)    { create(:project) }
    let(:p2)    { create(:project) }

    before { create(:project_membership, user: user, project: p1, role: "member") }

    it "멤버인 프로젝트의 공유 회의만 보인다" do
      mine = create(:meeting, project: p1, creator: user)
      other_shared = create(:meeting, project: p1, creator: create(:user), shared: true)
      foreign = create(:meeting, project: p2, creator: create(:user), shared: true)

      ids = Meeting.accessible_by(user).pluck(:id)
      expect(ids).to include(mine.id, other_shared.id)
      expect(ids).not_to include(foreign.id)   # 비멤버 프로젝트 → 안 보임
    end

    it "전역 admin은 프로젝트 무관 전부 본다" do
      admin = create(:user, :admin)
      foreign = create(:meeting, project: p2, creator: create(:user))
      expect(Meeting.accessible_by(admin).pluck(:id)).to include(foreign.id)
    end
  end
end
