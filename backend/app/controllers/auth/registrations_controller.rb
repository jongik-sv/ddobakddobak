class Auth::RegistrationsController < Devise::RegistrationsController
  respond_to :json

  # 프론트엔드가 JSON으로 회원가입을 요청하는 경우(Devise 기본 POST /auth)
  # 첫 번째 사용자는 admin으로 자동 승격한다.
  def create
    build_resource(sign_up_params)
    resource.role = "admin" if User.count.zero?

    resource.save
    if resource.persisted?
      sign_up(resource_name, resource)
      render json: {
        user: {
          id: resource.id,
          email: resource.email,
          name: resource.name,
          role: resource.role
        }
      }, status: :created
    else
      render json: { errors: resource.errors.full_messages }, status: :unprocessable_entity
    end
  end

  private

  def sign_up_params
    params.require(:user).permit(:email, :password, :password_confirmation, :name)
  end
end
