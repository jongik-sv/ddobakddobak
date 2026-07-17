module Api
  module V1
    class TrashController < ApplicationController
      before_action :authenticate_user!

      TYPE_MAP = { "meeting" => Meeting, "folder" => Folder, "project" => Project }.freeze

      # GET /trash — 내 root 휴지통 항목 (admin은 전체)
      def index
        items = TYPE_MAP.flat_map do |type, klass|
          my_root_scope(klass).map { |r| serialize_trash_item(type, r) }
        end
        render json: { items: items.sort_by { |i| i[:deleted_at].to_s }.reverse }
      end

      # POST /trash/:type/:id/restore
      def restore
        rec = find_root!
        return unless rec
        Trash::Restorer.call(rec.trash_group_id)
        head :no_content
      end

      # DELETE /trash/:type/:id
      def destroy
        rec = find_root!
        return unless rec
        return head :forbidden unless can_purge?(rec)
        Trash::Purger.call(rec.trash_group_id)
        head :no_content
      end

      # DELETE /trash — 내 휴지통 비우기
      def empty
        TYPE_MAP.each_value do |klass|
          my_root_scope(klass).each { |r| Trash::Purger.call(r.trash_group_id) if can_purge?(r) }
        end
        head :no_content
      end

      private

      # 내 root 휴지통 스코프 (admin은 전체 — 단 남의 개인 프로젝트 소속 항목은 제외).
      def my_root_scope(klass)
        scope = klass.trashed.where(trashed_as_root: true)
        if current_user.admin?
          exclude_others_personal(klass, scope)
        else
          scope.where(deleted_by_id: current_user.id)
        end
      end

      # klass별로 "남의 개인 프로젝트(personal=true, 소유자 ≠ current_user)" 소속 레코드를 제외한다.
      # project_id가 NULL인 레코드는 `NOT IN` 만으로는 SQL NULL 비교 규칙상 잘못 제외되므로 별도로 포함시킨다.
      def exclude_others_personal(klass, scope)
        if klass == Project
          scope.where.not(personal: true).or(scope.where(personal: true, created_by_id: current_user.id))
        else
          others_personal_ids = Project.where(personal: true).where.not(created_by_id: current_user.id).select(:id)
          scope.where(project_id: nil).or(scope.where.not(project_id: others_personal_ids))
        end
      end

      def find_root!
        klass = TYPE_MAP[params[:type]]
        unless klass
          head :bad_request
          return nil
        end
        rec = klass.trashed.where(trashed_as_root: true).find_by(id: params[:id])
        unless rec
          head :not_found
          return nil
        end
        unless (current_user.admin? && admin_reach?(rec)) || rec.deleted_by_id == current_user.id || owner?(rec)
          head :forbidden
          return nil
        end
        rec
      end

      # Project/Meeting → created_by_id 가 소유자. Folder 는 소유 컬럼이 없어 false.
      def owner?(rec)
        case rec
        when Project, Meeting then rec.created_by_id == current_user.id
        else false
        end
      end

      # admin override가 이 레코드(남의 개인 프로젝트 소속)에는 적용되면 안 될 때 false.
      def admin_reach?(rec)
        project = rec.is_a?(Project) ? rec : rec.project
        !project&.blocks_admin_override?(current_user)
      end

      # 영구삭제·비우기: admin(단 남의 개인 프로젝트 제외) 또는 소유자 또는 삭제 수행자
      def can_purge?(rec)
        (current_user.admin? && admin_reach?(rec)) || owner?(rec) || rec.deleted_by_id == current_user.id
      end

      def serialize_trash_item(type, rec)
        {
          type: type,
          id: rec.id,
          title: rec.try(:title) || rec.try(:name),
          deleted_at: rec.deleted_at,
          deleted_by_id: rec.deleted_by_id,
          trash_group_id: rec.trash_group_id
        }
      end
    end
  end
end
