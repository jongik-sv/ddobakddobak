module Api
  module V1
    class DecisionsController < ApplicationController
      include DecisionSerializable

      before_action :authenticate_user!
      before_action :set_decision, only: %i[update destroy]

      # GET /api/v1/decisions?folder_id=N
      def index
        meetings = Meeting.all
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

      def decision_params
        params.require(:decision).permit(:content, :context, :decided_at, :participants, :status)
      end
    end
  end
end
