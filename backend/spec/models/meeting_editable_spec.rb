require "rails_helper"

# Meeting#editable_by? — idea 44: 소유자/admin 외에 직접 지정 협업자·폴더 상속 협업자도 편집 가능.
RSpec.describe Meeting, "#editable_by?" do
  let(:owner)  { create(:user) }
  let(:other)  { create(:user) }
  let(:admin)  { create(:user, :admin) }
  let(:collaborator) { create(:user) }
  let(:root)   { create(:folder) }
  let(:mid)    { create(:folder, parent: root) }
  let(:leaf)   { create(:folder, parent: mid) }
  let(:meeting) { create(:meeting, creator: owner) }

  it "소유자는 true (기존 유지)" do
    expect(meeting.editable_by?(owner)).to be true
  end

  it "admin은 true (기존 유지)" do
    expect(meeting.editable_by?(admin)).to be true
  end

  it "직접 지정 협업자(MeetingCollaborator)는 true" do
    MeetingCollaborator.create!(meeting: meeting, user: collaborator)
    expect(meeting.editable_by?(collaborator)).to be true
  end

  it "소속 폴더의 협업자(직속)는 true" do
    m = create(:meeting, creator: owner, folder: leaf)
    FolderCollaborator.create!(folder: leaf, user: collaborator)
    expect(m.editable_by?(collaborator)).to be true
  end

  it "조상 폴더의 협업자(2단계 이상)는 true" do
    m = create(:meeting, creator: owner, folder: leaf)
    FolderCollaborator.create!(folder: root, user: collaborator)
    expect(m.editable_by?(collaborator)).to be true
  end

  it "무관한 사용자는 false" do
    expect(meeting.editable_by?(other)).to be false
  end

  it "user가 nil이면 false" do
    expect(meeting.editable_by?(nil)).to be false
  end

  # WP-B4: 목록 직렬화 N+1 회피용 배치 키워드 인자(collaborator_meeting_ids/collaborator_folder_ids).
  # 라이브 쿼리 경로(키워드 인자 없음)와 정확히 같은 불리언을 내야 한다.
  describe "배치 키워드 인자 (collaborator_meeting_ids/collaborator_folder_ids)" do
    it "직접 지정 협업자: 집합에 포함되면 true, 비어있으면 false" do
      MeetingCollaborator.create!(meeting: meeting, user: collaborator)
      expect(meeting.editable_by?(collaborator, collaborator_meeting_ids: Set[meeting.id], collaborator_folder_ids: Set.new)).to be true
      expect(meeting.editable_by?(collaborator, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set.new)).to be false
    end

    it "소속 폴더(직속) 협업자: folder_id가 집합에 포함되면 true" do
      m = create(:meeting, creator: owner, folder: leaf)
      expect(m.editable_by?(collaborator, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set[leaf.id])).to be true
      expect(m.editable_by?(collaborator, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set.new)).to be false
    end

    it "폴더가 없는 회의는 folder_ids 집합과 무관하게 false" do
      expect(meeting.editable_by?(collaborator, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set[999_999])).to be false
    end

    it "소유자/admin은 배치 인자가 비어있어도 true (단락 평가로 배치 조회 자체를 안 탐)" do
      expect(meeting.editable_by?(owner, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set.new)).to be true
      expect(meeting.editable_by?(admin, collaborator_meeting_ids: Set.new, collaborator_folder_ids: Set.new)).to be true
    end
  end
end
