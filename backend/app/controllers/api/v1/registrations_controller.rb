module Api
  module V1
    class RegistrationsController < Devise::RegistrationsController
      respond_to :json

      private

      def respond_with(resource, _opts = {})
        if resource.persisted?
          render json: {
            token: current_token,
            user: user_json(resource)
          }, status: :created
        else
          render json: { errors: resource.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def sign_up_params
        params.permit(:email, :password, :name)
      end

      def user_json(user)
        { id: user.id, email: user.email, name: user.name }
      end

      def current_token
        request.env["warden-jwt_auth.token"]
      end
    end
  end
end
