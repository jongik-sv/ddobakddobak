module Api
  module V1
    class MeetingDecisionsController < ApplicationController
      include DecisionSerializable
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      # GET /api/v1/meetings/:meeting_id/decisions
      def index
        decisions = @meeting.decisions.order(:created_at)
        render json: decisions.map { |d| serialize_decision(d) }
      end

      # POST /api/v1/meetings/:meeting_id/decisions
      def create
        decision = @meeting.decisions.build(decision_params)
        decision.ai_generated = false
        if decision.save
          render json: serialize_decision(decision), status: :created
        else
          render json: { errors: decision.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def decision_params
        params.require(:decision).permit(:content, :context, :decided_at, :participants, :status)
      end
    end
  end
end
