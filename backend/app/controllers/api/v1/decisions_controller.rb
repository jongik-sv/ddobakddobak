module Api
  module V1
    class DecisionsController < ApplicationController
      include DecisionSerializable
      include MeetingWriteGuard

      before_action :authenticate_user!
      before_action :set_decision, only: %i[update destroy]
      before_action :authorize_decision_control!, only: %i[update destroy]
      before_action :reject_if_locked!, only: %i[update destroy]

      # GET /api/v1/decisions?folder_id=N
      def index
        meetings = Meeting.accessible_by(current_user)
        meetings = meetings.where(folder_id: params[:folder_id]) if params[:folder_id].present?
        decisions = Decision.where(meeting_id: meetings.select(:id)).order(created_at: :desc)
        render json: decisions.map { |d| serialize_decision(d) }
      end

      # PATCH /api/v1/decisions/:id
      def update
        if @decision.update(decision_params)
          render json: serialize_decision(@decision.reload)
        else
          render json: { errors: @decision.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/decisions/:id
      def destroy
        @decision.destroy
        head :no_content
      end

      private

      def set_decision
        @decision = Decision.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Not found" }, status: :not_found
      end

      # MeetingWriteGuard#reject_if_locked! 대상 회의 = 이 결정의 회의.
      def locked_meeting
        @decision&.meeting
      end

      # 소유/admin만 변조 허용 (MeetingLookup#authorize_meeting_control!와 동일 티어).
      # 회의 공유(shared) 도입으로 비소유자가 decisions#index로 ID를 얻을 수 있으므로,
      # 이 최상위 update/destroy에도 회의 단위 제어 인가가 필수다.
      def authorize_decision_control!
        meeting = @decision.meeting
        return if current_user.respond_to?(:admin?) && current_user.admin?
        return if meeting.owner?(current_user)

        render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
      end

      def decision_params
        params.require(:decision).permit(:content, :context, :decided_at, :participants, :status)
      end
    end
  end
end
