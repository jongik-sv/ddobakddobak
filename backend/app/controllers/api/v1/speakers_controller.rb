module Api
  module V1
    class SpeakersController < ApplicationController
      include MeetingLookup
      include MeetingWriteGuard

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[update destroy_all]
      before_action :reject_if_locked!, only: %i[update destroy_all]

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
        # name == id 는 sidecar 규약상 "이름 미설정" — 비정규화 사본도 null 유지
        @meeting.transcripts.where(speaker_label: speaker_id)
                .update_all(speaker_name: name == speaker_id ? nil : name)
        render json: result
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :not_found
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def destroy_all
        SidecarClient.new.reset_speakers(@meeting.id)
        @meeting.transcripts.update_all(speaker_name: nil)
        render json: { ok: true }
      rescue SidecarClient::ConnectionError, SidecarClient::TimeoutError
        render json: { ok: true }
      end
    end
  end
end
