module Api
  module V1
    class MeetingSharesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting, only: %i[create_share destroy_share participants transfer_host]

      rescue_from MeetingShareService::NotHostError, with: :render_forbidden
      rescue_from MeetingShareService::InvalidShareCodeError, with: :render_not_found
      rescue_from MeetingShareService::ParticipantLimitError, with: :render_unprocessable
      rescue_from MeetingShareService::InvalidTargetError, with: :render_unprocessable

      # POST /api/v1/meetings/:id/share
      def create_share
        result = service.generate_share_code(@meeting, current_user)
        render json: { share_code: result[:share_code], participants: result[:participants] }
      end

      # DELETE /api/v1/meetings/:id/share
      def destroy_share
        service.revoke_share_code(@meeting, current_user)
        head :no_content
      end

      # POST /api/v1/meetings/join
      def join
        result = service.join_meeting(params[:share_code], current_user)
        render json: {
          meeting: { id: result[:meeting].id, title: result[:meeting].title },
          participant: result[:participant].as_summary
        }
      end

      # GET /api/v1/meetings/:id/participants
      def participants
        unless participant_or_creator?
          return render json: { error: "Access denied" }, status: :forbidden
        end

        render json: { participants: service.serialize_active_participants(@meeting) }
      end

      # POST /api/v1/meetings/:id/transfer_host
      def transfer_host
        result = service.transfer_host(@meeting, current_user, params[:target_user_id].to_i)
        render json: { participants: result[:participants] }
      end

      private

      def set_meeting
        @meeting = Meeting.find(params[:id])
      end

      def service
        @service ||= MeetingShareService.new
      end

      def participant_or_creator?
        @meeting.owner?(current_user) ||
          @meeting.active_participants.exists?(user: current_user)
      end

      def render_forbidden(exception)
        render json: { error: exception.message }, status: :forbidden
      end

      def render_not_found(exception)
        render json: { error: exception.message }, status: :not_found
      end

      def render_unprocessable(exception)
        render json: { error: exception.message }, status: :unprocessable_entity
      end
    end
  end
end
