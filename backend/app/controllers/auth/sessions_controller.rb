class Auth::SessionsController < Devise::SessionsController
  respond_to :json

  # POST /auth/login
  def create
    self.resource = warden.authenticate!(auth_options)
    sign_in(resource_name, resource)

    # access_token 은 devise-jwt 가 발급한 warden 토큰을 그대로 사용(sub 를 문자열로 직렬화 — 종전과 동일).
    render json: JwtService.issue_session(resource, access_token: request.env["warden-jwt_auth.token"])
  end

  # DELETE /auth/logout
  def destroy
    # Authenticate via JWT before sign_out (which clears the user)
    user = warden.authenticate!(scope: :user)
    user.revoke_refresh_token!
    # devise-jwt JTIMatcher regenerates jti via sign_out -> invalidates Access Token
    sign_out(resource_name)
    render json: { message: "logged out" }, status: :ok
  end

  # POST /auth/refresh
  def refresh
    payload = JwtService.decode_refresh_token(params[:refresh_token])
    user = User.find(payload["sub"])

    if user.refresh_token_jti == payload["jti"]
      new_access_token = JwtService.encode_access_token(user)
      render json: { access_token: new_access_token }
    else
      render json: { error: "Invalid refresh token" }, status: :unauthorized
    end
  rescue JWT::DecodeError, JWT::ExpiredSignature, ActiveRecord::RecordNotFound
    render json: { error: "Invalid refresh token" }, status: :unauthorized
  end

  private

  def respond_with(_resource, _opts = {})
    # Override Devise default (create handles render directly)
  end

  def respond_to_on_destroy(**)
    # Override Devise default (destroy handles render directly)
  end
end
