module Api
  module V1
    class SpeakersController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting

      def index
        result = SidecarClient.new.get_speakers(@meeting.id)
        render json: result
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { speakers: [] }
      end

      def update
        speaker_id = params[:id]
        name = params.require(:name)
        result = SidecarClient.new.rename_speaker(speaker_id, name, @meeting.id)
        render json: result
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :not_found
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def destroy_all
        SidecarClient.new.reset_speakers(@meeting.id)
        render json: { ok: true }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { ok: true }
      end
    end
  end
end
