module Api
  module V1
    class ProjectInvitesController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_project_as_admin!

      def index
        render json: { invites: @project.project_invites.order(created_at: :desc).map { |i| invite_json(i) } }
      end

      def create
        invite = ProjectInvite.generate!(
          project: @project, created_by: current_user,
          expires_at: params[:expires_at].presence, max_uses: params[:max_uses].presence
        )
        render json: { invite: invite_json(invite) }, status: :created
      end

      def destroy
        invite = @project.project_invites.find_by(id: params[:id])
        return head :not_found unless invite
        invite.destroy
        head :no_content
      end

      private

      def set_project_as_admin!
        @project = require_project!(params[:project_id])
        return if @project.nil?
        unless project_admin_override? || @project.admin?(current_user)
          render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden
        end
      end

      def invite_json(i)
        { id: i.id, code: i.code, expires_at: i.expires_at, max_uses: i.max_uses,
          use_count: i.use_count, redeemable: i.redeemable? }
      end
    end
  end
end
