module DefaultUserLookup
  extend ActiveSupport::Concern

  private

  def default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end.tap do |user|
      unless user.team_memberships.exists?
        team = Team.find_or_create_by!(name: "내 팀") { |t| t.creator = user }
        TeamMembership.find_or_create_by!(user: user, team: team) { |m| m.role = "admin" }
      end
    end
  end
end
