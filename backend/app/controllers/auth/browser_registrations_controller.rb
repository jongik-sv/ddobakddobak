class Auth::BrowserRegistrationsController < ApplicationController
  skip_before_action :verify_authenticity_token, raise: false

  before_action :set_callback
  before_action :require_valid_callback
  before_action :verify_csrf_token, only: :create

  ALLOWED_CALLBACK_SCHEMES = %w[ddobak].freeze
  CSRF_TOKEN_VALIDITY = 1.hour.to_i

  # GET /auth/web_register?callback=ddobak://
  def new
    @error = params[:error]
    render_register_form
  end

  # POST /auth/web_register
  def create
    user = User.new(
      email: params[:email],
      password: params[:password],
      name: params[:name]
    )

    # 첫 번째 사용자는 admin
    user.role = "admin" if User.count.zero?

    if user.save
      render_success_page(build_callback_url_with_tokens(user), message: "회원가입이 완료되었습니다!")
    else
      @error = user.errors.full_messages.join(", ")
      render_register_form(status: :unprocessable_content)
    end
  rescue ActiveRecord::RecordNotUnique
    @error = "이미 사용 중인 이메일입니다."
    render_register_form(status: :unprocessable_content)
  end

  private

  def set_callback
    @callback = params[:callback]
  end

  def require_valid_callback
    return if valid_callback?(@callback)

    render_error_page("잘못된 callback URL입니다.")
  end

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

  def render_register_form(status: :ok)
    html = RegisterFormTemplate.render(
      callback: @callback,
      error: @error,
      csrf_token: generate_csrf_token,
      action_url: "/auth/web_register"
    )
    render html: html.html_safe, status: status
  end

  def render_success_page(callback_url, message: "완료되었습니다.")
    html = LoginFormTemplate.render_success(callback_url: callback_url, message: message)
    render html: html.html_safe
  end

  def render_error_page(message, status: :bad_request)
    html = LoginFormTemplate.render_error(message: message)
    render html: html.html_safe, status: status
  end
end
