module Api
  module V1
    module Admin
      class UsersController < ApplicationController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_user, only: %i[update destroy reset_password]

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
          if @user.local_account? && update_params[:role].present? && update_params[:role] != "admin"
            return render json: { error: "로컬 계정의 역할은 변경할 수 없습니다." }, status: :forbidden
          end

          if @user.local_account? && update_params[:email].present? && update_params[:email] != ::User::LOCAL_EMAIL
            return render json: { error: "로컬 계정의 이메일은 변경할 수 없습니다." }, status: :forbidden
          end

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

          if @user.local_account?
            render json: { error: "로컬 계정은 삭제할 수 없습니다." }, status: :forbidden
            return
          end

          @user.destroy
          head :no_content
        end

        def reset_password
          if @user.local_account?
            return render json: { error: "로컬 계정의 비밀번호는 초기화할 수 없습니다." }, status: :forbidden
          end

          temp_password = SecureRandom.alphanumeric(12)
          @user.update!(password: temp_password)
          @user.invalidate_all_sessions!
          render json: { temp_password: temp_password }
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
          params.permit(:name, :role, :email)
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
