module Api
  module V1
    class HealthController < ApplicationController
      def show
        render json: { status: "ok" }, status: :ok
      end
    end
  end
end
