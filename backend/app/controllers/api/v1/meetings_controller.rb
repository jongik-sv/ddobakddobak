module Api
  module V1
    class MeetingsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting, only: %i[show update destroy start stop reopen reset_content summarize summary transcripts export feedback update_notes]

      def index
        meetings = Meeting.for_team(user_team_ids)
                          .search(params[:q])
                          .created_after(params[:date_from])
                          .created_before(params[:date_to])

        total    = meetings.count
        meetings = meetings.order(created_at: :desc)
                           .limit(pagination_per)
                           .offset((pagination_page - 1) * pagination_per)

        render json: {
          meetings: meetings.map { |m| meeting_json(m) },
          meta: { total: total, page: pagination_page, per: pagination_per }
        }
      end

      def create
        team = Team.find_by(id: params[:team_id])
        return render json: { error: "Team not found" }, status: :not_found unless team

        require_team_membership!(team)
        return if performed?

        meeting = Meeting.new(
          title: params[:title],
          team: team,
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general"
        )

        if meeting.save
          render json: { meeting: meeting_json(meeting) }, status: :created
        else
          render json: { errors: meeting.errors.full_messages }, status: :unprocessable_entity
        end
      end

      ALLOWED_AUDIO_TYPES = %w[
        audio/mpeg audio/mp3 audio/wav audio/x-wav audio/wave
        audio/m4a audio/mp4 audio/x-m4a audio/aac
        audio/webm audio/ogg video/webm
        audio/flac audio/x-flac
      ].freeze

      def upload_audio
        team = Team.find_by(id: params[:team_id])
        return render json: { error: "Team not found" }, status: :not_found unless team

        require_team_membership!(team)
        return if performed?

        audio_file = params[:audio]
        return render json: { error: "오디오 파일이 필요합니다" }, status: :unprocessable_entity unless audio_file.is_a?(ActionDispatch::Http::UploadedFile)

        # 파일 확장자 추출
        ext = File.extname(audio_file.original_filename).downcase.presence || ".webm"

        meeting = Meeting.create!(
          title: params[:title].presence || "업로드된 회의",
          team: team,
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general",
          status: :transcribing,
          source: "upload",
          started_at: Time.current
        )

        # 오디오 파일 저장 (AUDIO_DIR 환경변수로 외부 경로 지정 가능)
        storage_dir = Pathname.new(ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s })
        FileUtils.mkdir_p(storage_dir)
        audio_path = storage_dir.join("#{meeting.id}#{ext}").to_s

        File.open(audio_path, "wb") do |f|
          f.write(audio_file.read)
        end

        meeting.update!(audio_file_path: audio_path)

        # 백그라운드 처리 시작
        FileTranscriptionJob.perform_later(meeting.id)

        render json: { meeting: meeting_json(meeting) }, status: :created
      end

      def show
        render json: { meeting: meeting_json(@meeting, full: true) }
      end

      def update
        require_resource_owner_or_admin!(@meeting, @meeting.team)
        return if performed?

        if @meeting.update(title: params[:title])
          render json: { meeting: meeting_json(@meeting) }
        else
          render json: { errors: @meeting.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        require_resource_owner_or_admin!(@meeting, @meeting.team)
        return if performed?

        @meeting.destroy
        head :no_content
      end

      def start
        require_meeting_status!(@meeting, :pending?, "Meeting is not in pending state")
        return if performed?

        @meeting.update!(status: :recording, started_at: Time.current)
        render json: { meeting: meeting_json(@meeting) }
      end

      def stop
        require_meeting_status!(@meeting, :recording?, "Meeting is not in recording state")
        return if performed?

        @meeting.update!(status: :completed, ended_at: Time.current)
        # Sidecar 호출은 비동기 Job으로 — 실패해도 회의 종료에 영향 없음
        MeetingFinalizerJob.perform_later(@meeting.id)
        MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
        render json: { meeting: meeting_json(@meeting) }
      end

      def reopen
        require_meeting_status!(@meeting, :completed?, "Meeting is not completed")
        return if performed?

        @meeting.update!(status: :recording, ended_at: nil)
        render json: { meeting: meeting_json(@meeting) }
      end

      def reset_content
        @meeting.transcripts.destroy_all
        @meeting.summaries.destroy_all
        @meeting.action_items.destroy_all
        @meeting.blocks.destroy_all

        # 오디오 파일 삭제
        if @meeting.audio_file_path.present? && File.exist?(@meeting.audio_file_path)
          File.delete(@meeting.audio_file_path)
        end

        @meeting.update!(
          status: :pending,
          started_at: nil,
          ended_at: nil,
          last_refined_seq: 0,
          audio_file_path: nil
        )

        render json: { meeting: meeting_json(@meeting) }
      end

      def summarize
        if @meeting.pending?
          render json: { error: "Meeting has not started yet" }, status: :unprocessable_entity
          return
        end

        summary_type = @meeting.completed? ? "final" : "realtime"
        MeetingSummarizationJob.perform_later(@meeting.id, type: summary_type)
        render json: { ok: true }
      end

      def summary
        summary = @meeting.summaries.find_by(summary_type: "final") ||
                  @meeting.summaries.order(generated_at: :desc).first

        if summary
          render json: serialize_summary_hash(summary)
        else
          render json: { key_points: [], decisions: [], discussion_details: [], action_items: [] }
        end
      end

      def feedback
        feedback_text = params[:feedback]
        return render json: { error: "Feedback is required" }, status: :unprocessable_entity if feedback_text.blank?

        current_notes = current_notes_markdown(@meeting)
        # 기존 회의록이 없으면 빈 문자열로 시작 (메모 반영 등에서 새로 생성 가능)
        current_notes = "" if current_notes.blank?

        result = SidecarClient.new.feedback_notes(current_notes, feedback_text, meeting_title: @meeting.title)
        notes_markdown = result["notes_markdown"]

        if notes_markdown.present?
          summary = find_or_create_active_summary
          summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

          ActionCable.server.broadcast("meeting_#{@meeting.id}_transcription", {
            type: "meeting_notes_update",
            notes_markdown: notes_markdown
          })

          render json: { notes_markdown: notes_markdown }
        else
          render json: { error: "Failed to apply feedback" }, status: :unprocessable_entity
        end
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      def update_notes
        notes_markdown = params[:notes_markdown]
        return render json: { error: "notes_markdown is required" }, status: :unprocessable_entity if notes_markdown.nil?

        summary = find_or_create_active_summary
        summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)

        render json: { notes_markdown: notes_markdown }
      end

      def transcripts
        page     = pagination_page
        per_page = [ (params[:per_page] || 50).to_i, 5000 ].min

        transcripts = @meeting.transcripts
                              .reorder(:started_at_ms)
                              .offset((page - 1) * per_page)
                              .limit(per_page)

        render json: {
          transcripts: transcripts.map { |t| transcript_json(t) },
          page: page,
          per_page: per_page,
          total: @meeting.transcripts.count
        }
      end

      def export
        include_summary    = boolean_param(:include_summary)
        include_transcript = boolean_param(:include_transcript)

        markdown = MarkdownExporter.new(
          @meeting,
          include_summary:    include_summary,
          include_transcript: include_transcript
        ).call

        filename = "meeting_#{@meeting.id}_#{Date.today}.md"

        send_data markdown,
          type:        "text/markdown; charset=utf-8",
          disposition: "attachment",
          filename:    filename
      end

      private

      def set_meeting
        @meeting = Meeting.for_team(user_team_ids).find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def user_team_ids
        current_user.team_memberships.pluck(:team_id)
      end

      def pagination_page
        (params[:page] || 1).to_i
      end

      def pagination_per
        (params[:per] || 20).to_i
      end

      def require_meeting_status!(meeting, status_predicate, error_message)
        return if meeting.public_send(status_predicate)

        render json: { error: error_message }, status: :unprocessable_entity
      end

      # "false" 문자열만 false로 해석하고, 파라미터 미전달 시 true 반환
      def boolean_param(key)
        params.fetch(key, "true") != "false"
      end

      def current_notes_markdown(meeting)
        latest = meeting.summaries.find_by(summary_type: "final") ||
                 meeting.summaries.order(generated_at: :desc).first
        latest&.notes_markdown.to_s
      end

      def latest_summary_type
        @meeting.completed? ? "final" : "realtime"
      end

      # summary 액션과 동일한 레코드를 반환하거나, 없으면 새로 생성
      def find_or_create_active_summary
        @meeting.summaries.find_by(summary_type: "final") ||
          @meeting.summaries.order(generated_at: :desc).first ||
          @meeting.summaries.build(summary_type: latest_summary_type)
      end

      def meeting_json(meeting, full: false)
        json = {
          id: meeting.id,
          title: meeting.title,
          status: meeting.status,
          meeting_type: meeting.meeting_type,
          started_at: meeting.started_at,
          ended_at: meeting.ended_at,
          created_by_id: meeting.created_by_id,
          created_by: { id: meeting.created_by_id, name: meeting.creator&.name },
          brief_summary: meeting.brief_summary,
          source: meeting.source,
          transcription_progress: meeting.transcription_progress,
          audio_duration_ms: audio_duration_ms(meeting),
          last_sequence_number: meeting.transcripts.maximum(:sequence_number).to_i,
          created_at: meeting.created_at,
          updated_at: meeting.updated_at
        }

        if full
          json[:transcripts]   = serialize_transcripts(meeting)
          json[:summary]       = serialize_summary(meeting)
          json[:action_items]  = serialize_action_items(meeting)
        end

        json
      end

      def serialize_transcripts(meeting)
        meeting.transcripts.order(:started_at_ms).map do |t|
          {
            id: t.id,
            content: t.content,
            speaker_label: t.speaker_label,
            sequence_number: t.sequence_number,
            started_at_ms: t.started_at_ms,
            ended_at_ms: t.ended_at_ms
          }
        end
      end

      def serialize_summary(meeting)
        summary = meeting.summaries.find_by(summary_type: "final") ||
                  meeting.summaries.order(generated_at: :desc).first
        return nil unless summary

        serialize_summary_hash(summary)
      end

      def serialize_summary_hash(summary)
        {
          id: summary.id,
          summary_type: summary.summary_type,
          key_points: parse_json_field(summary.key_points),
          decisions: parse_json_field(summary.decisions),
          discussion_details: parse_json_field(summary.discussion_details),
          notes_markdown: summary.notes_markdown,
          generated_at: summary.generated_at
        }
      end

      def parse_json_field(value)
        return [] if value.nil?
        return value if value.is_a?(Array)
        JSON.parse(value)
      rescue JSON::ParserError
        []
      end

      def serialize_action_items(meeting)
        meeting.action_items.order(:created_at).map do |ai|
          {
            id: ai.id,
            content: ai.content,
            status: ai.status,
            ai_generated: ai.ai_generated,
            created_at: ai.created_at
          }
        end
      end

      def transcript_json(transcript)
        {
          id: transcript.id,
          content: transcript.content,
          speaker_label: transcript.speaker_label,
          started_at_ms: transcript.started_at_ms,
          ended_at_ms: transcript.ended_at_ms,
          sequence_number: transcript.sequence_number,
          applied_to_minutes: transcript.applied_to_minutes
        }
      end

      def audio_duration_ms(meeting)
        path = meeting.audio_file_path
        return 0 unless path.present? && File.exist?(path)

        output = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
        (output.to_f * 1000).to_i
      rescue StandardError
        0
      end
    end
  end
end
