module Api
  module V1
    class HealthController < ApplicationController
      def show
        data = { status: "ok" }
        if server_mode? && request.headers["Authorization"].present?
          user = warden.authenticate(scope: :user)
          data[:user] = user_json(user) if user
        elsif !server_mode?
          user = local_default_user
          data[:user] = user_json(user)
        end
        render json: data, status: :ok
      end

      private

      def user_json(user)
        { id: user.id, email: user.email, name: user.name, role: user.role }
      end
    end
  end
end
