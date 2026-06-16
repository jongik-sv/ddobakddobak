class ProjectMembership < ApplicationRecord
  belongs_to :user
  belongs_to :project

  validates :role, inclusion: { in: %w[admin member] }
  validates :user_id, uniqueness: { scope: :project_id, message: "is already a member of this project" }
end
