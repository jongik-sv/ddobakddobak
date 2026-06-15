module Api
  module V1
    class GlossaryEntriesController < ApplicationController
      before_action :authenticate_user!

      def index
        owner = resolve_owner
        return render json: { error: "Not found" }, status: :not_found unless owner
        return unless authorize_owner_edit!(owner)

        render json: { entries: owner.glossary_entries.order(:id).map { |e| serialize(e) } }
      end

      def create
        owner = resolve_owner
        return render json: { error: "Not found" }, status: :not_found unless owner
        return unless authorize_owner_edit!(owner)

        entry = owner.glossary_entries.build(entry_params.merge(created_by_id: current_user.id))
        if entry.save
          render json: { entry: serialize(entry) }, status: :created
        else
          render json: { errors: entry.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        entry = GlossaryEntry.find(params[:id])
        return unless authorize_owner_edit!(entry.owner)

        if entry.update(entry_params)
          render json: { entry: serialize(entry) }
        else
          render json: { errors: entry.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      def destroy
        entry = GlossaryEntry.find(params[:id])
        return unless authorize_owner_edit!(entry.owner)
        entry.destroy
        head :no_content
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      private

      def resolve_owner
        if params[:meeting_id]
          Meeting.find_by(id: params[:meeting_id])
        elsif params[:folder_id]
          Folder.find_by(id: params[:folder_id])
        end
      end

      # 인가 통과면 true, 아니면 403 렌더 후 false.
      def authorize_owner_edit!(owner)
        ok = case owner
             when Meeting then meeting_controllable?(owner)
             when Folder  then owner.editable_by?(current_user)
             else false
             end
        return true if ok
        render json: { error: "사전을 편집할 권한이 없습니다" }, status: :forbidden
        false
      end

      def meeting_controllable?(meeting)
        return true if current_user.respond_to?(:admin?) && current_user.admin?
        return true if meeting.owner?(current_user)
        meeting.host_participant&.user_id == current_user.id
      end

      def entry_params
        permitted = {}
        permitted[:from_text]  = params[:from_text] if params.key?(:from_text)
        permitted[:to_text]    = params[:to_text] if params.key?(:to_text)
        permitted[:match_type] = params[:match_type] if params.key?(:match_type)
        permitted[:enabled]    = ActiveModel::Type::Boolean.new.cast(params[:enabled]) if params.key?(:enabled)
        permitted
      end

      def serialize(entry)
        {
          id: entry.id,
          from_text: entry.from_text,
          to_text: entry.to_text,
          match_type: entry.match_type,
          enabled: entry.enabled,
          owner_type: entry.owner_type,
          owner_id: entry.owner_id
        }
      end
    end
  end
end
