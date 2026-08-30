module Api
  module V1
    # 웹 UI에서 본인의 외부 API(PAT) 토큰을 발급·조회·폐기한다. 기존 JWT 인증(authenticate_user!)
    # 을 그대로 쓴다 — Ext::V1과 달리 이건 "내부" API(로그인 사용자 전용)다.
    class ApiTokensController < ApplicationController
      before_action :authenticate_user!
      before_action :set_token, only: %i[destroy]

      def index
        tokens = current_user.api_tokens.order(created_at: :desc).map { |t| serialize(t) }
        render json: { tokens: tokens }
      end

      def create
        token, plaintext = ApiToken.issue!(
          user: current_user,
          name: token_params[:name],
          scopes: token_params[:scopes],
          expires_at: token_params[:expires_at],
          project_ids: token_params[:project_ids],
          folder_ids: token_params[:folder_ids]
        )
        render json: { token: serialize(token), plaintext: plaintext }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      def destroy
        @token.revoke!
        head :no_content
      end

      private

      # 본인 것만 — 쿼리 파라미터가 아니라 레코드 소유로 판정.
      def set_token
        @token = current_user.api_tokens.find(params[:id])
      end

      def token_params
        params.permit(:name, :expires_at, scopes: [], project_ids: [], folder_ids: [])
      end

      # digest는 절대 노출하지 않는다.
      def serialize(token)
        {
          id: token.id,
          name: token.name,
          token_prefix: token.token_prefix,
          scopes: token.scopes,
          project_ids: token.project_ids,
          folder_ids: token.folder_ids,
          expires_at: token.expires_at,
          revoked_at: token.revoked_at,
          last_used_at: token.last_used_at,
          created_at: token.created_at
        }
      end
    end
  end
end
