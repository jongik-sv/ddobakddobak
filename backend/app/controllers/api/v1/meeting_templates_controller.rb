module Api
  module V1
    class MeetingTemplatesController < ApplicationController
      before_action :authenticate_user!
      # 회의 템플릿은 중앙 집중관리 — 조회는 모두, 변경은 관리자 전용.
      before_action :require_admin!, only: %i[create update destroy]
      before_action :set_template, only: %i[update destroy]

      def index
        templates = MeetingTemplate.order(updated_at: :desc)
        render json: templates.map { |t| template_json(t) }
      end

      def create
        template = MeetingTemplate.new(template_params)
        if template.save
          render json: template_json(template), status: :created
        else
          render json: { errors: template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @template.update(template_params)
          render json: template_json(@template)
        else
          render json: { errors: @template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @template.destroy!
        head :no_content
      end

      private

      def set_template
        @template = MeetingTemplate.find(params[:id])
      end

      def template_params
        params.permit(:name, :meeting_type, :folder_id, settings_json: {})
      end

      def template_json(template)
        {
          id: template.id,
          name: template.name,
          meeting_type: template.meeting_type,
          folder_id: template.folder_id,
          settings_json: template.settings_json,
          created_at: template.created_at,
          updated_at: template.updated_at
        }
      end
    end
  end
end
