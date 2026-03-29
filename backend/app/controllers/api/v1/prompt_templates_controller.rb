module Api
  module V1
    class PromptTemplatesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_template, only: %i[update destroy reset]

      def index
        templates = PromptTemplate.ordered
        render json: templates.map { |t| template_json(t) }
      end

      def create
        template = PromptTemplate.new(template_params.merge(is_default: false))
        if template.save
          render json: template_json(template), status: :created
        else
          render json: { errors: template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @template.update(template_params.slice(:label, :sections_prompt))
          render json: template_json(@template)
        else
          render json: { errors: @template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        if @template.is_default?
          render json: { error: "기본 유형은 삭제할 수 없습니다." }, status: :unprocessable_entity
          return
        end
        @template.destroy!
        head :no_content
      end

      def reset
        unless @template.is_default?
          render json: { error: "커스텀 유형은 초기화할 수 없습니다." }, status: :unprocessable_entity
          return
        end

        defaults = PromptTemplate::DEFAULT_TEMPLATES[@template.meeting_type]
        unless defaults
          render json: { error: "기본값을 찾을 수 없습니다." }, status: :not_found
          return
        end

        @template.update!(
          label: defaults[:label],
          sections_prompt: defaults[:sections_prompt]
        )
        render json: template_json(@template)
      end

      private

      def set_template
        @template = PromptTemplate.find(params[:id])
      end

      def template_params
        params.permit(:meeting_type, :label, :sections_prompt)
      end

      def template_json(template)
        {
          id: template.id,
          meeting_type: template.meeting_type,
          label: template.label,
          sections_prompt: template.sections_prompt,
          is_default: template.is_default,
          created_at: template.created_at,
          updated_at: template.updated_at
        }
      end
    end
  end
end
