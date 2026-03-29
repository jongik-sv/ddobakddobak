module Api
  module V1
    class TagsController < ApplicationController
      before_action :authenticate_user!

      def index
        tags = Tag.for_team(user_team_ids).ordered
        render json: { tags: tags.map { |t| tag_json(t) } }
      end

      def create
        team = Team.find_by(id: params[:team_id])
        return render json: { error: "Team not found" }, status: :not_found unless team

        tag = Tag.new(name: params[:name], color: params[:color] || "#6b7280", team: team)

        if tag.save
          render json: { tag: tag_json(tag) }, status: :created
        else
          render json: { errors: tag.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        tag = Tag.for_team(user_team_ids).find(params[:id])
        attrs = {}
        attrs[:name] = params[:name] if params.key?(:name)
        attrs[:color] = params[:color] if params.key?(:color)

        if tag.update(attrs)
          render json: { tag: tag_json(tag) }
        else
          render json: { errors: tag.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        tag = Tag.for_team(user_team_ids).find(params[:id])
        tag.destroy
        head :no_content
      end

      private

      def user_team_ids
        current_user.team_memberships.pluck(:team_id)
      end

      def tag_json(tag)
        { id: tag.id, name: tag.name, color: tag.color, team_id: tag.team_id }
      end
    end
  end
end
