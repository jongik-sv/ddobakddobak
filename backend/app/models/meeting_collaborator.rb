# idea 44: 회의 개별 협업자 지정. role 없이 존재 유무로 판단(project_memberships와 대비되는 단순 이진 부여).
class MeetingCollaborator < ApplicationRecord
  belongs_to :meeting
  belongs_to :user

  validates :user_id, uniqueness: { scope: :meeting_id }
end
