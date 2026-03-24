module Api
  module V1
    class TranscriptsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting

      def index
        transcripts = @meeting.transcripts.order(:sequence_number)
        render json: {
          transcripts: transcripts.map { |t| transcript_json(t) }
        }
      end

      def destroy_batch
        ids = Array(params[:ids]).map(&:to_i)
        return render json: { error: "ids required" }, status: :unprocessable_entity if ids.empty?

        deleted_count = @meeting.transcripts.where(id: ids).delete_all
        render json: { deleted: deleted_count }
      end

      private

      def set_meeting
        team_ids = current_user.team_memberships.pluck(:team_id)
        @meeting = Meeting.for_team(team_ids).find(params[:meeting_id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def transcript_json(t)
        {
          id: t.id,
          speaker_label: t.speaker_label,
          content: t.content,
          started_at_ms: t.started_at_ms,
          ended_at_ms: t.ended_at_ms,
          sequence_number: t.sequence_number,
          applied_to_minutes: t.applied_to_minutes
        }
      end
    end
  end
end
