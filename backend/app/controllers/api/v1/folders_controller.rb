module Api
  module V1
    class FoldersController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_folder, only: %i[update destroy move_to_project domain_files update_domain_files]
      before_action :authorize_folder_edit!, only: %i[update destroy move_to_project domain_files update_domain_files]

      def index
        project = require_project!(params[:project_id])
        return unless project

        if params[:flat] == "true"
          # flat은 이동-폴더 선택기용이라 비공개 폴더도 노출(숨김은 트리만). 카운트만 접근 스코프.
          folders = Folder.kept.ordered.where(project_id: project.id).to_a
          counts = Meeting.accessible_by(current_user).where(project_id: project.id)
                          .where(folder_id: folders.map(&:id)).group(:folder_id).count
          render json: { folders: folders.map { |f| folder_json(f, counts[f.id] || 0) } }
        else
          render json: { folders: Folder.tree(current_user, project.id) }
        end
      end

      def create
        project = require_project!(params[:project_id])
        return unless project

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
          project_id: project.id,
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
        permitted[:important] = ActiveModel::Type::Boolean.new.cast(params[:important]) if params.key?(:important)

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
        Trash::SoftDeleter.call(@folder, by: current_user)
        head :no_content
      end

      def move_to_project
        target = require_project!(params[:target_project_id])
        return unless target

        if target.id == @folder.project_id
          return render json: { error: "이미 해당 프로젝트의 폴더입니다" }, status: :unprocessable_entity
        end

        ids = @folder.subtree_ids
        moved_meetings = 0
        Folder.transaction do
          Folder.where(id: ids).update_all(project_id: target.id)
          @folder.update_column(:parent_id, nil) # 루트만 최상위 안착, 내부구조 보존
          moved_meetings = Meeting.where(folder_id: ids).update_all(project_id: target.id)
        end
        render json: { moved_folders: ids.size, moved_meetings: moved_meetings }
      end

      # 폴더에 링크된(적용된) 도메인 파일(용어집) 목록.
      def domain_files
        render json: { domain_files: folder_domain_files_json(@folder) }
      end

      # 폴더의 도메인 파일 링크 세트를 통째로 교체(빈 배열=전체 해제).
      def update_domain_files
        ids = Array(params[:domain_file_ids]).reject(&:blank?).map(&:to_i).uniq

        if ids.any?
          accessible_ids = DomainFile.accessible_by(current_user).where(id: ids).pluck(:id)
          if accessible_ids.sort != ids.sort
            return render json: { error: "선택할 수 없는 파일이 포함되어 있습니다" }, status: :unprocessable_entity
          end
        end

        ActiveRecord::Base.transaction do
          @folder.domain_file_links.destroy_all
          ids.each { |id| @folder.domain_file_links.create!(domain_file_id: id) }
        end

        render json: { domain_files: folder_domain_files_json(@folder.reload) }
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

      def folder_domain_files_json(folder)
        folder.domain_files.order("domain_file_links.id").map { |f| f.summary_json(current_user) }
      end

      def folder_json(folder, meeting_count = nil)
        {
          id: folder.id,
          name: folder.name,
          parent_id: folder.parent_id,
          position: folder.position,
          shared: folder.shared,
          important: folder.important,
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
