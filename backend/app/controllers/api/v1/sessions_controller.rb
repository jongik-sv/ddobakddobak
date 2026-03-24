module Api
  module V1
    class SessionsController < Devise::SessionsController
      skip_before_action :verify_authenticity_token, raise: false
      skip_before_action :verify_signed_out_user,    raise: false

      respond_to :json

      def create
        user = User.find_by(email: sign_in_params[:email])
        if user&.valid_password?(sign_in_params[:password])
          sign_in(user)
          token = request.env["warden-jwt_auth.token"]
          render json: {
            token: token,
            user: { id: user.id, email: user.email, name: user.name }
          }, status: :ok
        else
          render json: { error: "Invalid email or password" }, status: :unauthorized
        end
      end

      def destroy
        return unless authenticate_user!

        current_user.update_column(:jti, SecureRandom.uuid)
        head :no_content
      end

      private

      def sign_in_params
        params.permit(:email, :password)
      end
    end
  end
end
