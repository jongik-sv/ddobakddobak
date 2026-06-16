module Api
  module V1
    class TagsController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!

      def index
        tags = Tag.ordered
        tags = tags.where(project_id: params[:project_id]) if params[:project_id].present?
        render json: { tags: tags.map { |t| tag_json(t) } }
      end

      def create
        project = require_project!(params[:project_id])
        return unless project

        tag = Tag.new(name: params[:name], color: params[:color] || "#6b7280", project_id: project.id)

        if tag.save
          render json: { tag: tag_json(tag) }, status: :created
        else
          render json: { errors: tag.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        tag = Tag.find(params[:id])
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
        tag = Tag.find(params[:id])
        tag.destroy
        head :no_content
      end

      private

      def tag_json(tag)
        { id: tag.id, name: tag.name, color: tag.color }
      end
    end
  end
end
