module TeamAuthorizable
  extend ActiveSupport::Concern

  # 팀 멤버 여부 확인 (멤버가 아니면 403)
  def require_team_membership!(team)
    membership = team.team_memberships.find_by(user: current_user)
    render json: { error: "Forbidden" }, status: :forbidden unless membership
  end

  # 팀 admin 여부 확인 (admin이 아니면 403)
  def require_team_admin!(team)
    membership = team.team_memberships.find_by(user: current_user)
    render json: { error: "Forbidden" }, status: :forbidden unless membership&.role == "admin"
  end

  # 리소스 생성자 또는 팀 admin만 허용
  def require_resource_owner_or_admin!(resource, team)
    membership = team.team_memberships.find_by(user: current_user)
    is_owner = resource.respond_to?(:created_by_id) && resource.created_by_id == current_user.id
    is_admin = membership&.role == "admin"
    render json: { error: "Forbidden" }, status: :forbidden unless is_owner || is_admin
  end
end
