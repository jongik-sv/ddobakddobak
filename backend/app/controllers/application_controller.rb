class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include DefaultUserLookup

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

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end
end
