class TeamMembership < ApplicationRecord
  belongs_to :user
  belongs_to :team

  validates :role, inclusion: { in: %w[admin member] }
  validates :user_id, uniqueness: { scope: :team_id, message: "is already a member of this team" }
end
