module Api
  module V1
    class MeetingActionItemsController < ApplicationController
      include ActionItemSerializable
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      # GET /api/v1/meetings/:meeting_id/action_items
      def index
        items = @meeting.action_items.includes(:assignee).order(:created_at)
        render json: items.map { |item| serialize_item(item) }
      end

      # POST /api/v1/meetings/:meeting_id/action_items
      def create
        item = @meeting.action_items.build(action_item_params)
        item.ai_generated = false
        if item.save
          render json: serialize_item(item), status: :created
        else
          render json: { errors: item.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def action_item_params
        params.require(:action_item).permit(:content, :assignee_id, :due_date, :status)
      end
    end
  end
end
