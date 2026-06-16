module Api
  module V1
    class ProjectsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_project, only: %i[invite remove_member]

      def index
        memberships = current_user.project_memberships.includes(:project)
        projects = memberships.map do |m|
          {
            id: m.project.id,
            name: m.project.name,
            role: m.role,
            member_count: m.project.project_memberships.count
          }
        end
        render json: projects
      end

      def create
        project = Project.new(name: params[:name], creator: current_user)
        if project.save
          membership = ProjectMembership.create!(user: current_user, project: project, role: "admin")
          render json: {
            project: {
              id: project.id,
              name: project.name,
              role: membership.role,
              member_count: 1
            }
          }, status: :created
        else
          render json: { errors: project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def invite
        invited_user = ::User.find_by(email: params[:email])
        return render json: { error: "User not found" }, status: :not_found unless invited_user

        membership = ProjectMembership.new(user: invited_user, project: @project, role: "member")
        if membership.save
          render json: {
            membership: {
              user_id: membership.user_id,
              project_id: membership.project_id,
              role: membership.role
            }
          }, status: :created
        else
          render json: { errors: membership.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def remove_member
        membership = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "Member not found" }, status: :not_found unless membership

        membership.destroy
        head :no_content
      end

      private

      def set_project
        membership = current_user.project_memberships.includes(:project).find_by(project_id: params[:id])
        if membership
          @project = membership.project
        else
          render json: { error: "Forbidden" }, status: :forbidden
        end
      end
    end
  end
end
