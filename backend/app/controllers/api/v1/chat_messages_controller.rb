module Api
  module V1
    class ChatMessagesController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      # set_meeting 가 내부에서 authorize_meeting_read! 까지 수행한다(읽기 인가 포함).
      before_action :set_meeting

      def index
        messages = @meeting.chat_messages.for_user(current_user).order(:created_at)
        render json: messages.map { |m| serialize(m) }
      end

      def create
        content = params[:content].to_s.strip
        return render(json: { error: "질문을 입력하세요." }, status: :unprocessable_entity) if content.blank?

        user_msg = nil
        assistant_msg = nil
        ChatMessage.transaction do
          user_msg = @meeting.chat_messages.create!(user: current_user, role: "user", content: content, status: "complete")
          assistant_msg = @meeting.chat_messages.create!(user: current_user, role: "assistant", content: "", status: "pending")
        end
        MeetingChatJob.perform_later(assistant_msg.id)
        render json: { user_message: serialize(user_msg), assistant_message: serialize(assistant_msg) }, status: :created
      end

      private

      def serialize(m)
        { id: m.id, role: m.role, content: m.content, status: m.status,
          error_message: m.error_message, created_at: m.created_at }
      end
    end
  end
end
