module Api
  module V1
    class ScopedChatMessagesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_scope
      before_action :authorize_scope!

      def index
        messages = ChatMessage.for_scope(@scope_type, @scope_id).for_user(current_user).order(:created_at)
        render json: messages.map { |m| serialize(m) }
      end

      def create
        content = params[:content].to_s.strip
        return render(json: { error: "질문을 입력하세요." }, status: :unprocessable_entity) if content.blank?

        user_msg = nil
        assistant_msg = nil
        ChatMessage.transaction do
          user_msg = ChatMessage.create!(scope_type: @scope_type, scope_id: @scope_id, user: current_user,
                                         role: "user", content: content, status: "complete")
          assistant_msg = ChatMessage.create!(scope_type: @scope_type, scope_id: @scope_id, user: current_user,
                                              role: "assistant", content: "", status: "pending")
        end
        FolderChatJob.perform_later(assistant_msg.id)
        render json: { user_message: serialize(user_msg), assistant_message: serialize(assistant_msg) }, status: :created
      end

      private

      def set_scope
        @scope_type = params[:scope_type]
        @scope_id   = (params[:folder_id] || params[:project_id]).to_i
      end

      def authorize_scope!
        return if current_user.respond_to?(:admin?) && current_user.admin?

        project = case @scope_type
        when "folder"  then ::Folder.find_by(id: @scope_id)&.project
        when "project" then ::Project.find_by(id: @scope_id)
        end
        head :forbidden and return unless project&.member?(current_user)
      end

      def serialize(m)
        { id: m.id, role: m.role, content: m.content, status: m.status,
          suggestions: m.suggestions, error_message: m.error_message, created_at: m.created_at }
      end
    end
  end
end
