module Api
  module V1
    class FoldersController < ApplicationController
      before_action :authenticate_user!
      before_action :set_folder, only: %i[update destroy]
      before_action :authorize_folder_edit!, only: %i[update destroy]

      def index
        if params[:flat] == "true"
          # flat은 이동-폴더 선택기용이라 비공개 폴더도 노출(숨김은 트리만). 카운트만 접근 스코프.
          folders = Folder.ordered.to_a
          counts = Meeting.accessible_by(current_user)
                          .where(folder_id: folders.map(&:id)).group(:folder_id).count
          render json: { folders: folders.map { |f| folder_json(f, counts[f.id] || 0) } }
        else
          tree = Folder.tree(current_user)
          render json: { folders: tree }
        end
      end

      def create
        if params[:parent_id].present?
          parent = Folder.find_by(id: params[:parent_id])
          return render json: { error: "상위 폴더가 없습니다" }, status: :not_found unless parent
          unless parent.editable_by?(current_user)
            return render json: { error: "상위 폴더에 생성할 권한이 없습니다" }, status: :forbidden
          end
        end

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
        permitted[:shared] = ActiveModel::Type::Boolean.new.cast(params[:shared]) if params.key?(:shared)

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

      def authorize_folder_edit!
        return if @folder.editable_by?(current_user)
        render json: { error: "폴더를 편집할 권한이 없습니다" }, status: :forbidden
      end

      def next_position(parent_id)
        Folder.where(parent_id: parent_id).maximum(:position).to_i + 1
      end

      def folder_json(folder, meeting_count = nil)
        {
          id: folder.id,
          name: folder.name,
          parent_id: folder.parent_id,
          position: folder.position,
          shared: folder.shared,
          meeting_count: meeting_count || folder.meetings.accessible_by(current_user).count,
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
