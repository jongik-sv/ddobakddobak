class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include TeamAuthorizable

  before_action :configure_permitted_parameters, if: :devise_controller?

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  private

  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
    devise_parameter_sanitizer.permit(:sign_in, keys: [ :email ])
  end

  def authenticate_user!
    token = bearer_token
    payload = token && decode_jwt(token)
    unless payload
      render json: { error: "Unauthorized" }, status: :unauthorized
      return false
    end
    @current_user = User.find_by(id: payload["sub"], jti: payload["jti"])
    unless @current_user
      render json: { error: "Unauthorized" }, status: :unauthorized
      return false
    end
    true
  end

  def current_user
    @current_user ||= begin
      token = bearer_token
      payload = token && decode_jwt(token)
      User.find_by(id: payload["sub"], jti: payload["jti"]) if payload
    end
  end

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end

  def bearer_token
    request.headers["Authorization"]&.split(" ")&.last
  end

  def decode_jwt(token)
    secret = Rails.application.credentials.secret_key_base
    decoded = JWT.decode(token, secret, true, algorithm: "HS256")
    decoded.first
  rescue JWT::DecodeError, JWT::ExpiredSignature
    nil
  end
end
