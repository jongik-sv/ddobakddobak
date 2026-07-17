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
        if @project.personal?
          return render json: { error: "개인 프로젝트에는 초대를 만들 수 없습니다" }, status: :conflict
        end

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

        ok = if @project.personal?
          project_admin_override?(@project) || @project.admin?(current_user)
        else
          # 초대는 팀 프로젝트 전용 기능 — 시스템 manager 이상을 요구한다.
          current_user.manager_or_above? && (project_admin_override?(@project) || @project.admin?(current_user))
        end

        render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden unless ok
      end

      def invite_json(i)
        { id: i.id, code: i.code, expires_at: i.expires_at, max_uses: i.max_uses,
          use_count: i.use_count, redeemable: i.redeemable? }
      end
    end
  end
end
