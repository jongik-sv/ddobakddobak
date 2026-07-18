module Api
  module V1
    class LlmProfilesController < ApplicationController
      include TokenMasking

      before_action :authenticate_user!
      before_action :require_admin_for_server_scope!, only: %i[index create]
      before_action :set_profile, only: %i[update destroy]

      def index
        render json: { profiles: pool_scope.order(:id).map { |p| masked(p) } }
      end

      def create
        profile = pool_scope.new(profile_params)
        profile.save!
        after_server_pool_change(profile) if profile.user_id.nil?
        render json: { profile: masked(profile) }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      def update
        attrs = profile_params
        attrs = attrs.except(:auth_token) if attrs[:auth_token].blank? # blank = 기존 키 유지
        @profile.update!(attrs)
        after_server_pool_change(@profile) if @profile.user_id.nil?
        render json: { profile: masked(@profile) }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      def destroy
        @profile.destroy!
        after_server_pool_change(@profile) if @profile.user_id.nil?
        head :no_content
      end

      private

      def server_scope? = params[:scope] == "server"

      def require_admin_for_server_scope!
        require_admin! if server_scope?
      end

      def pool_scope
        server_scope? ? LlmProfile.server_pool : LlmProfile.personal_for(current_user)
      end

      # update/destroy는 레코드 소속으로 권한 판정(쿼리 파라미터 신뢰 안 함)
      def set_profile
        @profile = LlmProfile.find(params[:id])
        if @profile.user_id.nil?
          result = require_admin!
          return if performed? # require_admin!이 403 렌더한 경우
          result
        elsif @profile.user_id != current_user&.id
          raise ActiveRecord::RecordNotFound
        end
      end

      def profile_params
        params.require(:profile).permit(
          :name, :preset_id, :provider, :base_url, :model,
          :auth_token, :max_input_tokens, :max_output_tokens
        )
      end

      def masked(profile)
        profile.as_masked_json(method(:mask_token))
      end

      # 서버 풀 변경 훅 — Task 4에서 settings.yaml 재실체화로 구현. 지금은 no-op.
      def after_server_pool_change(_profile); end
    end
  end
end
