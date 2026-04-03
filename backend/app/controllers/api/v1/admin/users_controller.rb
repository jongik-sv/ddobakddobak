module Api
  module V1
    module Admin
      class UsersController < ApplicationController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_user, only: %i[update destroy]

        def index
          users = ::User.all.order(created_at: :desc)
          render json: { users: users.map { |u| user_json(u) } }
        end

        def create
          user = ::User.new(create_params)
          if user.save
            render json: { user: user_json(user) }, status: :created
          else
            render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
          end
        end

        def update
          if @user.update(update_params)
            render json: { user: user_json(@user) }
          else
            render json: { errors: @user.errors.full_messages }, status: :unprocessable_entity
          end
        end

        def destroy
          if @user == current_user
            render json: { error: "Cannot delete yourself" }, status: :forbidden
            return
          end

          @user.destroy
          head :no_content
        end

        private

        def require_admin!
          render json: { error: "Forbidden" }, status: :forbidden unless current_user.admin?
        end

        def set_user
          @user = ::User.find(params[:id])
        end

        def create_params
          params.permit(:email, :name, :password, :role)
        end

        def update_params
          params.permit(:name, :role)
        end

        def user_json(user)
          {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            created_at: user.created_at,
            updated_at: user.updated_at
          }
        end
      end
    end
  end
end
