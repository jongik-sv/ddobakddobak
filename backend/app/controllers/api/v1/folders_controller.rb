module Api
  module V1
    class FoldersController < ApplicationController
      before_action :authenticate_user!
      before_action :set_folder, only: %i[update destroy]

      def index
        if params[:flat] == "true"
          folders = Folder.for_team(user_team_ids).ordered
          render json: { folders: folders.map { |f| folder_json(f) } }
        else
          tree = Folder.tree_for_team(user_team_ids)
          render json: { folders: tree }
        end
      end

      def create
        team = Team.find_by(id: params[:team_id])
        return render json: { error: "Team not found" }, status: :not_found unless team

        folder = Folder.new(
          name: params[:name],
          team: team,
          parent_id: params[:parent_id],
          position: params[:position] || next_position(team, params[:parent_id])
        )

        if folder.save
          render json: { folder: folder_json(folder) }, status: :created
        else
          render json: { errors: folder.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        permitted = {}
        permitted[:name] = params[:name] if params.key?(:name)
        permitted[:position] = params[:position] if params.key?(:position)
        permitted[:parent_id] = params[:parent_id] if params.key?(:parent_id)

        if @folder.update(permitted)
          render json: { folder: folder_json(@folder) }
        else
          render json: { errors: @folder.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        parent_id = @folder.parent_id
        @folder.children.update_all(parent_id: parent_id)
        @folder.meetings.update_all(folder_id: parent_id)
        @folder.destroy
        head :no_content
      end

      private

      def set_folder
        @folder = Folder.for_team(user_team_ids).find(params[:id])
      end

      def user_team_ids
        current_user.team_memberships.pluck(:team_id)
      end

      def next_position(team, parent_id)
        Folder.where(team: team, parent_id: parent_id).maximum(:position).to_i + 1
      end

      def folder_json(folder)
        {
          id: folder.id,
          name: folder.name,
          team_id: folder.team_id,
          parent_id: folder.parent_id,
          position: folder.position,
          meeting_count: folder.meetings.count,
          children_count: folder.children.count,
          ancestors: folder.ancestors,
          created_at: folder.created_at,
          updated_at: folder.updated_at
        }
      end
    end
  end
end
