module Api
  module V1
    module User
      class PasswordsController < ApplicationController
        before_action :authenticate_user!

        # PATCH /api/v1/user/password
        def update
          if current_user.local_account?
            return render json: { error: "로컬 계정은 비밀번호를 변경할 수 없습니다." }, status: :forbidden
          end

          unless current_user.valid_password?(params[:current_password])
            return render json: { error: "현재 비밀번호가 일치하지 않습니다." }, status: :unprocessable_entity
          end

          if params[:new_password].blank? || params[:new_password] != params[:new_password_confirmation]
            return render json: { error: "새 비밀번호가 일치하지 않습니다." }, status: :unprocessable_entity
          end

          if current_user.update(password: params[:new_password])
            current_user.invalidate_all_sessions!
            new_refresh_jti = current_user.generate_refresh_token_jti!
            render json: {
              access_token: JwtService.encode_access_token(current_user),
              refresh_token: JwtService.encode_refresh_token(current_user, new_refresh_jti)
            }
          else
            render json: { errors: current_user.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end
    end
  end
end
