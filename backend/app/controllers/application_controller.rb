class ApplicationController < ActionController::API
  include ActionController::MimeResponds
  include DefaultUserLookup

  rescue_from ActiveRecord::RecordNotFound, with: :record_not_found
  rescue_from ActionController::ParameterMissing, with: :parameter_missing

  protected

  def require_admin!
    return true unless server_mode?
    unless current_user&.admin?
      render json: { error: "Forbidden" }, status: :forbidden
    end
  end

  private

  def authenticate_user!
    @current_user = resolve_current_user
    return true if @current_user

    # 서버 모드 + 원격 요청 + 유효 JWT 없음 → 401
    warden.authenticate!(scope: :user)
    true
  end

  def current_user
    @current_user ||= resolve_current_user
  end

  # 하이브리드 인증 — 한 백엔드로 "맥 본체=로컬 / 타기기=서버"를 동시에 만족.
  # - 로컬 모드(SERVER_MODE off): 항상 desktop@local.
  # - 서버 모드 + 유효 JWT: 그 사용자 (명시 로그인이 항상 우선).
  # - 서버 모드 + loopback 요청(JWT 없음): desktop@local 로컬 admin 폴백.
  # - 서버 모드 + 원격 요청(JWT 없음): nil → authenticate_user!가 401.
  def resolve_current_user
    return local_default_user unless server_mode?

    warden.authenticate(scope: :user) || (local_request? ? local_default_user : nil)
  end

  def record_not_found(exception)
    render json: { error: exception.message }, status: :not_found
  end

  def parameter_missing(exception)
    render json: { error: exception.message }, status: :bad_request
  end
end
