module Api
  module V1
    class ActionItemsController < ApplicationController
      include ActionItemSerializable

      before_action :authenticate_user!
      before_action :set_action_item

      # PATCH /api/v1/action_items/:id
      def update
        if @action_item.update(action_item_params)
          render json: serialize_item(@action_item.reload)
        else
          render json: { errors: @action_item.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/action_items/:id
      def destroy
        @action_item.destroy
        head :no_content
      end

      private

      def set_action_item
        @action_item = ActionItem.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      def action_item_params
        params.require(:action_item).permit(:assignee_id, :due_date, :status, :content)
      end
    end
  end
end
