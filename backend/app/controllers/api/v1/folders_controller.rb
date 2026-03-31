module Api
  module V1
    class FoldersController < ApplicationController
      before_action :authenticate_user!
      before_action :set_folder, only: %i[update destroy]

      def index
        if params[:flat] == "true"
          folders = Folder.ordered
          render json: { folders: folders.map { |f| folder_json(f) } }
        else
          tree = Folder.tree
          render json: { folders: tree }
        end
      end

      def create
        folder = Folder.new(
          name: params[:name],
          parent_id: params[:parent_id],
          position: params[:position] || next_position(params[:parent_id])
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

        if params.key?(:tag_ids)
          tag_ids = Array(params[:tag_ids]).map(&:to_i)
          @folder.tag_ids = tag_ids
        end

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
        @folder = Folder.find(params[:id])
      end

      def next_position(parent_id)
        Folder.where(parent_id: parent_id).maximum(:position).to_i + 1
      end

      def folder_json(folder)
        {
          id: folder.id,
          name: folder.name,
          parent_id: folder.parent_id,
          position: folder.position,
          meeting_count: folder.meetings.count,
          children_count: folder.children.count,
          tags: folder.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
          ancestors: folder.ancestors,
          created_at: folder.created_at,
          updated_at: folder.updated_at
        }
      end
    end
  end
end
