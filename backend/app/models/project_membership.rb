class ProjectMembership < ApplicationRecord
  belongs_to :user
  belongs_to :project

  validates :role, inclusion: { in: %w[admin member] }
  validates :user_id, uniqueness: { scope: :project_id, message: "is already a member of this project" }
  validate :creator_only_for_personal_project

  private

  # 최후 방어선: 개인 프로젝트에는 생성자 본인 외 멤버십을 만들 수 없다.
  def creator_only_for_personal_project
    return unless project&.personal?
    return if user_id == project.created_by_id

    errors.add(:user_id, "개인 프로젝트에는 멤버를 추가할 수 없습니다")
  end
end
