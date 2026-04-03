module Api
  module V1
    class MeetingsController < ApplicationController
      include MeetingLookup

      before_action :authenticate_user!
      before_action :set_meeting, only: %i[show update destroy start stop reopen reset_content summarize summary transcripts export export_prompt feedback update_notes regenerate_stt regenerate_notes]

      def index
        meetings = Meeting.search(params[:q])
                          .by_status(params[:status])
                          .created_after(params[:date_from])
                          .created_before(params[:date_to])

        if params.key?(:folder_id)
          if params[:folder_id] == "null"
            meetings = meetings.where(folder_id: nil)
          else
            meetings = meetings.where(folder_id: params[:folder_id])
          end
        end

        total    = meetings.count
        meetings = meetings.includes(:creator, :tags, :meeting_attachments)
                           .order(created_at: :desc)
                           .limit(pagination_per)
                           .offset((pagination_page - 1) * pagination_per)

        render json: {
          meetings: meetings.map { |m| meeting_json(m) },
          meta: { total: total, page: pagination_page, per: pagination_per }
        }
      end

      def create
        meeting = Meeting.new(
          title: params[:title],
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general",
          folder_id: params[:folder_id]
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
        audio_file = params[:audio]
        return render json: { error: "오디오 파일이 필요합니다" }, status: :unprocessable_entity unless audio_file.is_a?(ActionDispatch::Http::UploadedFile)

        # 파일 확장자 추출
        ext = File.extname(audio_file.original_filename).downcase.presence || ".webm"

        meeting = Meeting.create!(
          title: params[:title].presence || "업로드된 회의",
          created_by_id: current_user.id,
          meeting_type: params[:meeting_type] || "general",
          folder_id: params[:folder_id],
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

        # MP4/M4A: moov atom을 파일 앞으로 이동하여 브라우저 스트리밍 재생 지원
        if %w[.m4a .mp4 .aac].include?(ext)
          faststart_path = "#{audio_path}.faststart#{ext}"
          if system("ffmpeg", "-y", "-i", audio_path, "-c", "copy", "-movflags", "+faststart", faststart_path, out: File::NULL, err: File::NULL)
            FileUtils.mv(faststart_path, audio_path)
          else
            FileUtils.rm_f(faststart_path)
          end
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
        attrs = {}
        attrs[:title] = params[:title] if params.key?(:title)
        attrs[:folder_id] = params[:folder_id] if params.key?(:folder_id)
        attrs[:meeting_type] = params[:meeting_type] if params.key?(:meeting_type)
        attrs[:memo] = params[:memo] if params.key?(:memo)
        attrs[:brief_summary] = params[:brief_summary] if params.key?(:brief_summary)

        if params.key?(:tag_ids)
          tag_ids = Array(params[:tag_ids]).map(&:to_i)
          @meeting.tag_ids = tag_ids
        end

        if @meeting.update(attrs)
          render json: { meeting: meeting_json(@meeting) }
        else
          render json: { errors: @meeting.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def move_to_folder
        meeting_ids = params[:meeting_ids]
        return render json: { error: "meeting_ids is required" }, status: :unprocessable_entity if meeting_ids.blank?

        meetings = Meeting.where(id: meeting_ids)
        meetings.update_all(folder_id: params[:folder_id])
        render json: { updated: meetings.count }
      end

      def destroy
        FileUtils.rm_f(@meeting.audio_file_path) if @meeting.audio_file_path.present?
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

        # 참여자에게 녹음 종료 브로드캐스트
        ActionCable.server.broadcast(
          @meeting.transcription_stream,
          { type: "recording_stopped", meeting_id: @meeting.id }
        )

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
        @meeting.meeting_attachments.destroy_all

        FileUtils.rm_f(@meeting.audio_file_path) if @meeting.audio_file_path.present?

        @meeting.update!(
          status: :pending,
          started_at: nil,
          ended_at: nil,
          last_refined_seq: 0,
          audio_file_path: nil,
          brief_summary: nil
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

      def regenerate_stt
        require_meeting_status!(@meeting, :completed?, "완료된 회의만 재생성 가능합니다")
        return if performed?

        unless @meeting.audio_file_path.present? && File.exist?(@meeting.audio_file_path)
          return render json: { error: "오디오 파일이 없습니다" }, status: :unprocessable_entity
        end

        @meeting.transcripts.destroy_all
        @meeting.summaries.destroy_all
        @meeting.action_items.destroy_all
        @meeting.blocks.destroy_all

        @meeting.update!(status: :transcribing, transcription_progress: 0, last_refined_seq: 0)
        FileTranscriptionJob.perform_later(@meeting.id)

        render json: { meeting: meeting_json(@meeting) }
      end

      def regenerate_notes
        if @meeting.pending?
          return render json: { error: "아직 시작되지 않은 회의입니다" }, status: :unprocessable_entity
        end
        unless @meeting.transcripts.exists?
          return render json: { error: "트랜스크립트가 없습니다" }, status: :unprocessable_entity
        end

        @meeting.summaries.destroy_all
        @meeting.action_items.where(ai_generated: true).destroy_all

        MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
        render json: { ok: true }
      end

      def summary
        summary = @meeting.active_summary

        if summary
          render json: serialize_summary_hash(summary)
        else
          render json: { key_points: [], decisions: [], discussion_details: [], action_items: [] }
        end
      end

      def feedback
        corrections = params[:corrections]
        return render json: { error: "Corrections are required" }, status: :unprocessable_entity if corrections.blank?

        corrections = corrections.map { |c| { from: c[:from].to_s, to: c[:to].to_s } }
                                 .reject { |c| c[:from].blank? }

        return render json: { error: "No valid corrections provided" }, status: :unprocessable_entity if corrections.empty?

        # 회의록(notes_markdown) 치환
        current_notes = @meeting.current_notes_markdown || ""
        corrected_notes = apply_term_corrections(current_notes, corrections)

        if corrected_notes != current_notes && corrected_notes.present?
          summary = find_or_create_active_summary
          summary.update!(notes_markdown: corrected_notes, generated_at: Time.current)
          @meeting.refresh_brief_summary!(corrected_notes)

          ActionCable.server.broadcast(@meeting.transcription_stream, {
            type: "meeting_notes_update",
            notes_markdown: corrected_notes
          })
        end

        # 트랜스크립트 원문 치환
        corrected_count = 0
        @meeting.transcripts.find_each do |transcript|
          original = transcript.content
          corrected = apply_term_corrections(original, corrections)
          if corrected != original
            transcript.update!(content: corrected)
            corrected_count += 1
          end
        end

        render json: { notes_markdown: corrected_notes, corrected_transcripts: corrected_count }
      end

      def update_notes
        notes_markdown = params[:notes_markdown]
        return render json: { error: "notes_markdown is required" }, status: :unprocessable_entity if notes_markdown.nil?

        summary = find_or_create_active_summary
        summary.update!(notes_markdown: notes_markdown, generated_at: Time.current)
        @meeting.refresh_brief_summary!(notes_markdown)

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
        include_memo       = boolean_param(:include_memo)
        include_transcript = boolean_param(:include_transcript)

        if params[:export_format] == "json"
          data = MeetingExportSerializer.new(
            @meeting,
            include_summary:    include_summary,
            include_memo:       include_memo,
            include_transcript: include_transcript
          ).call

          render json: data
        else
          markdown = MarkdownExporter.new(
            @meeting,
            include_summary:    include_summary,
            include_memo:       include_memo,
            include_transcript: include_transcript
          ).call

          filename = "meeting_#{@meeting.id}_#{Date.today}.md"

          send_data markdown,
            type:        "text/markdown; charset=utf-8",
            disposition: "attachment",
            filename:    filename
        end
      end

      def export_prompt
        transcripts = @meeting.transcripts.order(:sequence_number)
        if transcripts.empty?
          return render json: { error: "트랜스크립트가 없습니다" }, status: :unprocessable_entity
        end

        current_notes = @meeting.current_notes_markdown
        payload = Transcript.to_sidecar_payload(transcripts)
        sections_prompt = PromptTemplate.sections_prompt_for(@meeting.meeting_type)

        result = SidecarClient.new.build_prompt(
          current_notes, payload,
          meeting_title: @meeting.title,
          sections_prompt: sections_prompt
        )

        filename = "prompt_#{@meeting.id}_#{Date.today}.txt"
        send_data result["prompt_text"],
          type:        "text/plain; charset=utf-8",
          disposition: "attachment",
          filename:    filename
      rescue SidecarClient::SidecarError => e
        render json: { error: e.message }, status: :service_unavailable
      end

      private

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

      def latest_summary_type
        @meeting.completed? ? "final" : "realtime"
      end

      def find_or_create_active_summary
        @meeting.active_summary ||
          @meeting.summaries.build(summary_type: latest_summary_type)
      end

      def meeting_json(meeting, full: false)
        attachment_counts = meeting.meeting_attachments.loaded? ?
          meeting.meeting_attachments.group_by(&:category).transform_values(&:size) :
          meeting.meeting_attachments.group(:category).count

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
          has_audio_file: meeting.audio_file_path.present?,
          folder_id: meeting.folder_id,
          memo: meeting.memo,
          tags: meeting.tags.map { |t| { id: t.id, name: t.name, color: t.color } },
          attachment_counts: {
            agenda: attachment_counts["agenda"] || 0,
            reference: attachment_counts["reference"] || 0,
            minutes: attachment_counts["minutes"] || 0
          },
          created_at: meeting.created_at,
          updated_at: meeting.updated_at
        }

        if full
          json[:audio_duration_ms] = audio_duration_ms(meeting)
          json[:last_transcript_end_ms] = meeting.transcripts.maximum(:ended_at_ms).to_i
          json[:last_sequence_number] = meeting.transcripts.maximum(:sequence_number).to_i
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
        summary = meeting.active_summary
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

      def apply_term_corrections(text, corrections)
        result = text
        corrections.each { |c| result = result.gsub(c[:from], c[:to]) }
        result
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
