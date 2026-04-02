class Auth::BrowserSessionsController < ApplicationController
  # Skip JWT authentication — this controller serves unauthenticated browser users
  skip_before_action :verify_authenticity_token, raise: false

  before_action :set_callback
  before_action :require_valid_callback
  before_action :verify_csrf_token, only: :create

  ALLOWED_CALLBACK_SCHEMES = %w[ddobak].freeze
  CSRF_TOKEN_VALIDITY = 1.hour.to_i

  # GET /auth/web_login?callback=ddobak://
  def new
    @error = params[:error]
    render_login_form
  end

  # POST /auth/web_login
  def create
    user = User.find_by(email: params[:email])

    if user&.valid_password?(params[:password])
      redirect_to build_callback_url_with_tokens(user), allow_other_host: true
    else
      @error = "이메일 또는 비밀번호가 올바르지 않습니다."
      render_login_form(status: :unauthorized)
    end
  end

  private

  # ── Before actions ──

  def set_callback
    @callback = params[:callback]
  end

  def require_valid_callback
    return if valid_callback?(@callback)

    render_error_page("잘못된 callback URL입니다.")
  end

  # ── Callback URL helpers ──

  def valid_callback?(callback)
    return false if callback.blank?

    uri = URI.parse(callback)
    ALLOWED_CALLBACK_SCHEMES.include?(uri.scheme)
  rescue URI::InvalidURIError
    false
  end

  def build_callback_url_with_tokens(user)
    access_token = JwtService.encode_access_token(user)
    refresh_jti = user.generate_refresh_token_jti!
    refresh_token = JwtService.encode_refresh_token(user, refresh_jti)

    build_callback_url(@callback,
      access_token: access_token,
      refresh_token: refresh_token)
  end

  def build_callback_url(callback, access_token:, refresh_token:)
    uri = URI.parse(callback)
    query = URI.encode_www_form(
      access_token: access_token,
      refresh_token: refresh_token
    )

    base = uri.host.present? ? "#{uri.scheme}://#{uri.host}#{uri.path}" : "#{uri.scheme}://callback"
    "#{base}?#{query}"
  end

  # ── HMAC-based CSRF protection (stateless, no session needed) ──

  def generate_csrf_token
    timestamp = Time.current.to_i
    signature = OpenSSL::HMAC.hexdigest("SHA256", csrf_secret, timestamp.to_s)
    "#{timestamp}:#{signature}"
  end

  def valid_csrf_token?(token)
    return false if token.blank?

    timestamp, signature = token.split(":", 2)
    return false if signature.blank?
    return false if (Time.current.to_i - timestamp.to_i) > CSRF_TOKEN_VALIDITY

    expected = OpenSSL::HMAC.hexdigest("SHA256", csrf_secret, timestamp)
    ActiveSupport::SecurityUtils.secure_compare(signature, expected)
  end

  def csrf_secret
    Rails.application.secret_key_base
  end

  def verify_csrf_token
    return if valid_csrf_token?(params[:authenticity_token])

    render_error_page("유효하지 않은 요청입니다. 다시 시도해 주세요.",
      status: :unprocessable_content)
  end

  # ── HTML rendering ──

  def render_login_form(status: :ok)
    html = LoginFormTemplate.render(
      callback: @callback,
      error: @error,
      csrf_token: generate_csrf_token,
      action_url: "/auth/web_login"
    )
    render html: html.html_safe, status: status
  end

  def render_error_page(message, status: :bad_request)
    html = LoginFormTemplate.render_error(message: message)
    render html: html.html_safe, status: status
  end
end
