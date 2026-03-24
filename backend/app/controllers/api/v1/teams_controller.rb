module Api
  module V1
    class TeamsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_team, only: %i[invite remove_member]
      before_action :check_team_admin, only: %i[invite remove_member]

      def index
        memberships = current_user.team_memberships.includes(:team)
        teams = memberships.map do |m|
          {
            id: m.team.id,
            name: m.team.name,
            role: m.role,
            member_count: m.team.team_memberships.count
          }
        end
        render json: teams
      end

      def create
        team = Team.new(name: params[:name], creator: current_user)
        if team.save
          membership = TeamMembership.create!(user: current_user, team: team, role: "admin")
          render json: {
            team: {
              id: team.id,
              name: team.name,
              role: membership.role,
              member_count: 1
            }
          }, status: :created
        else
          render json: { errors: team.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def invite
        invited_user = User.find_by(email: params[:email])
        return render json: { error: "User not found" }, status: :not_found unless invited_user

        membership = TeamMembership.new(user: invited_user, team: @team, role: "member")
        if membership.save
          render json: {
            membership: {
              user_id: membership.user_id,
              team_id: membership.team_id,
              role: membership.role
            }
          }, status: :created
        else
          render json: { errors: membership.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def remove_member
        membership = @team.team_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "Member not found" }, status: :not_found unless membership

        membership.destroy
        head :no_content
      end

      private

      def set_team
        membership = current_user.team_memberships.includes(:team).find_by(team_id: params[:id])
        if membership
          @team = membership.team
        else
          render json: { error: "Forbidden" }, status: :forbidden
        end
      end

      def check_team_admin
        return unless @team
        require_team_admin!(@team)
      end
    end
  end
end
