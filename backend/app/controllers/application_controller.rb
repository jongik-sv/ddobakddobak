class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include DefaultUserLookup

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  private

  def authenticate_user!
    if server_mode?
      # Server mode: JWT authentication via Warden/devise-jwt
      warden.authenticate!(scope: :user)
      @current_user = warden.user(:user)
    else
      # Local mode: existing desktop@local flow
      @current_user = local_default_user
    end
    true
  end

  def current_user
    @current_user ||= if server_mode?
      warden.user(:user)
    else
      local_default_user
    end
  end

  # Local mode only: desktop@local user
  # Bypasses concern's server_mode? guard
  def local_default_user
    User.find_or_create_by!(email: "desktop@local") do |u|
      u.name = "사용자"
    end
  end

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end
end
