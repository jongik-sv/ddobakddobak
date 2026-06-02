module Api
  module V1
    class ActionItemsController < ApplicationController
      include ActionItemSerializable

      before_action :authenticate_user!
      before_action :set_action_item
      before_action :authorize_item_control!, only: %i[update destroy]

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

      # 소유/admin/현재 host만 변조 허용 (MeetingLookup#authorize_meeting_control!와 동일 티어).
      # 회의 공유(shared) 도입으로 비소유자가 action_items#index로 ID를 얻을 수 있으므로,
      # 이 최상위 update/destroy에도 회의 단위 제어 인가가 필수다.
      def authorize_item_control!
        meeting = @action_item.meeting
        return if current_user.respond_to?(:admin?) && current_user.admin?
        return if meeting.owner?(current_user)
        return if meeting.host_participant&.user_id == current_user.id

        render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
      end

      def action_item_params
        params.require(:action_item).permit(:assignee_id, :due_date, :status, :content)
      end
    end
  end
end
