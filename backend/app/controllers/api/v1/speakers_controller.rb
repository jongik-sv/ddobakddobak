module Api
  module V1
    class SpeakersController < ApplicationController
      before_action :authenticate_user!

      def index
        meeting_id = params.require(:meeting_id)
        result = SidecarClient.new.get_speakers(meeting_id)
        render json: result
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { speakers: [] }
      end

      def update
        meeting_id = params.require(:meeting_id)
        speaker_id = params[:id]
        name = params.require(:name)
        result = SidecarClient.new.rename_speaker(speaker_id, name, meeting_id)
        render json: result
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :not_found
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def destroy_all
        meeting_id = params.require(:meeting_id)
        SidecarClient.new.reset_speakers(meeting_id)
        render json: { ok: true }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { ok: true }
      end
    end
  end
end
