module Api
  module V1
    class ProjectsController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_project, only: %i[show update destroy members update_member remove_member]
      before_action :authorize_project_admin!, only: %i[update destroy update_member remove_member]

      def index
        projects = current_user.admin? ? Project.all : current_user.projects
        render json: { projects: projects.distinct.map { |p| project_json(p) } }
      end

      def show
        render json: { project: project_json(@project) }
      end

      def create
        project = Project.new(project_params.merge(creator: current_user))
        if project.save
          ProjectMembership.create!(project: project, user: current_user, role: "admin")
          render json: { project: project_json(project) }, status: :created
        else
          render json: { errors: project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @project.update(project_params)
          render json: { project: project_json(@project) }
        else
          render json: { errors: @project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        unless @project.deletable?
          msg = @project.personal? ? "개인 프로젝트는 삭제할 수 없습니다" : "회의·폴더가 남아 있어 삭제할 수 없습니다"
          return render json: { error: msg }, status: :conflict
        end
        @project.destroy
        head :no_content
      end

      def members
        render json: { members: @project.project_memberships.includes(:user).map { |pm| member_json(pm) } }
      end

      def update_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "멤버를 찾을 수 없습니다" }, status: :not_found unless pm
        if pm.update(role: params[:role])
          render json: { member: member_json(pm) }
        else
          render json: { errors: pm.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def remove_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "멤버를 찾을 수 없습니다" }, status: :not_found unless pm
        pm.destroy
        head :no_content
      end

      private

      def set_project
        @project = require_project!(params[:id])
      end

      def authorize_project_admin!
        return if @project.nil? # require_project! 가 이미 렌더
        return if project_admin_override? || @project.admin?(current_user)
        render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden
      end

      def project_params
        params.permit(:name, :description, :icon_type, :icon_value, :color)
      end

      def project_json(p)
        {
          id: p.id, name: p.name, description: p.description,
          icon_type: p.icon_type, icon_value: p.icon_value, color: p.color,
          personal: p.personal,
          role: p.project_memberships.find_by(user_id: current_user.id)&.role,
          member_count: p.project_memberships.count,
          meeting_count: p.meetings.count
        }
      end

      def member_json(pm)
        { user_id: pm.user_id, name: pm.user.name, email: pm.user.email, role: pm.role }
      end
    end
  end
end
