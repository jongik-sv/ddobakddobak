module Api
  module V1
    class TranscriptsController < ApplicationController
      include MeetingLookup

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

      def update_content
        content = params[:content].to_s
        trimmed = content.strip
        if trimmed.empty?
          return render json: { error: "content blank" }, status: :unprocessable_entity
        end
        if content.length > 5000
          return render json: { error: "content too long" }, status: :unprocessable_entity
        end

        transcript = @meeting.transcripts.find_by(id: params[:id])
        return render json: { error: "Transcript not found" }, status: :not_found unless transcript

        transcript.update!(content: content)
        @meeting.update!(last_user_edit_at: Time.current)

        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          {
            type: "transcript_updated",
            id: transcript.id,
            content: transcript.content,
            client_id: params[:client_id]
          }
        )

        render json: { transcript: transcript_json(transcript) }
      end

      private

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
