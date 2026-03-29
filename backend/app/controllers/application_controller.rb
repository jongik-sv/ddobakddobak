class ApplicationController < ActionController::API
  include ActionController::MimeResponds

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  private

  def authenticate_user!
    @current_user = default_user
    true
  end

  def current_user
    @current_user ||= default_user
  end

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

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end
end
