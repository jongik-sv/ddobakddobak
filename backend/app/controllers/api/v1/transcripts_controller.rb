module Api
  module V1
    class TranscriptsController < ApplicationController
      include MeetingLookup
      include TranscriptSerializable
      include MeetingWriteGuard

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[destroy_batch bulk_create update_content]
      before_action :reject_if_locked!, only: %i[bulk_create update_content destroy_batch]

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

      # POST /api/v1/meetings/:meeting_id/transcripts/bulk
      # 온디바이스(로컬) STT 결과를 서버에 영속화한다.
      # body: { transcripts: [{ content, speaker_label, started_at_ms,
      #                         ended_at_ms, sequence_number, audio_source }] }
      # 멱등: (meeting_id, sequence_number) 기준 find_or_initialize → update.
      # 같은 sequence_number 재전송 시 중복 행을 만들지 않고 갱신만 한다.
      def bulk_create
        items = params[:transcripts]
        unless items.is_a?(Array)
          return render json: { error: "transcripts array required" }, status: :unprocessable_entity
        end

        saved = []
        ActiveRecord::Base.transaction do
          items.each do |raw|
            attrs = bulk_transcript_attrs(raw)
            next if attrs.nil?

            transcript = @meeting.transcripts.find_or_initialize_by(
              sequence_number: attrs[:sequence_number]
            )
            transcript.assign_attributes(attrs)
            # speaker_label은 로컬 단일/미상 화자에서 빈 문자열("")이 정상값이라
            # 모델의 presence 검증을 우회한다. content/시간 필드는 위에서 직접 가드.
            transcript.save!(validate: false)
            saved << transcript
          end
        end

        saved.each do |transcript|
          ActionCable.server.broadcast(
            @meeting.transcription_stream,
            {
              id: transcript.id,
              type: "final",
              text: transcript.content,
              speaker: transcript.speaker_label,
              audio_source: transcript.audio_source,
              started_at_ms: transcript.started_at_ms,
              ended_at_ms: transcript.ended_at_ms,
              seq: transcript.sequence_number,
              created_at: transcript.created_at.iso8601
            }
          )
        end

        render json: {
          created: saved.length,
          transcripts: saved.map { |t| transcript_json(t) }
        }
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
        transcript.meeting.reconcile_embeddings!
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

      # 단일 bulk 아이템을 검증·정규화해 attrs 해시로 반환한다.
      # 유효하지 않으면(내용 공백/길이 초과/필수 숫자 누락) nil을 반환해 스킵한다.
      def bulk_transcript_attrs(raw)
        return nil unless raw.respond_to?(:[])

        content = raw[:content].to_s
        trimmed = content.strip
        return nil if trimmed.empty?
        return nil if content.length > 5000

        seq = raw[:sequence_number]
        started = raw[:started_at_ms]
        ended = raw[:ended_at_ms]
        return nil if seq.nil? || started.nil? || ended.nil?

        source = raw[:audio_source].to_s
        source = "mic" unless %w[mic system].include?(source)

        {
          content: content,
          speaker_label: raw[:speaker_label].to_s, # 빈 문자열("") 허용 = 로컬 단일/미상 화자
          started_at_ms: started.to_i,
          ended_at_ms: ended.to_i,
          sequence_number: seq.to_i,
          audio_source: source
        }
      end
    end
  end
end
