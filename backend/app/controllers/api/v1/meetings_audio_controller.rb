module Api
  module V1
    class MeetingsAudioController < ApplicationController
      include MeetingLookup
      include AudioStorage

      ALLOWED_AUDIO_CONTENT_TYPES = %w[audio/webm audio/ogg video/webm audio/mp4 audio/wav audio/x-wav audio/wave].freeze
      AUDIO_MIME_OVERRIDES = { ".m4a" => "audio/mp4", ".aac" => "audio/aac" }.freeze

      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_control!, only: %i[create chunk finalize]

      def create
        audio_file = params.require(:audio)

        unless valid_audio_content_type?(audio_file.content_type)
          render json: { error: "Invalid file type. Only WebM/Opus is supported." },
                 status: :unprocessable_entity
          return
        end

        dest_path = save_or_merge_audio(audio_file, @meeting)
        @meeting.set_audio_file!(dest_path)
        AudioUploadJob.perform_later(meeting_id: @meeting.id)

        render json: { audio_available: true }, status: :created
      end

      # 녹음 중 연속 청크 업로드: seq별 part 파일로 저장 (중간에 죽어도 직전까지 보존)
      def chunk
        chunk_file = params.require(:chunk)
        sequence   = params.require(:sequence).to_i

        unless valid_audio_content_type?(chunk_file.content_type)
          render json: { error: "Invalid chunk type." }, status: :unprocessable_entity
          return
        end

        dir = parts_dir(@meeting.id)
        FileUtils.mkdir_p(dir)
        FileUtils.cp(chunk_file.tempfile.path, File.join(dir, "#{sequence}.part"))

        render json: { received: sequence }, status: :ok
      end

      # 녹음 종료: part들을 seq 순서로 이어붙여 webm 생성 → mp3 변환 잡 트리거
      def finalize
        dir = parts_dir(@meeting.id)
        parts = Dir.glob(File.join(dir, "*.part"))
                   .sort_by { |p| File.basename(p, ".part").to_i }

        if parts.empty?
          render json: { error: "No audio chunks" }, status: :unprocessable_entity
          return
        end

        FileUtils.mkdir_p(audio_dir)
        dest = File.join(audio_dir, "#{@meeting.id}.webm")
        File.open(dest, "wb") do |out|
          parts.each { |p| out.write(File.binread(p)) }
        end

        @meeting.set_audio_file!(dest)
        AudioUploadJob.perform_later(meeting_id: @meeting.id)
        FileUtils.rm_rf(dir)

        render json: { audio_available: true }, status: :ok
      end

      def show
        path = @meeting.audio_file_path

        unless audio_file_accessible?(path)
          render json: { error: "Audio not found" }, status: :not_found
          return
        end

        ext = File.extname(path).downcase
        mime = AUDIO_MIME_OVERRIDES[ext] || Rack::Mime.mime_type(ext, "application/octet-stream")
        send_file path,
                  type:        mime,
                  disposition: "inline",
                  filename:    "#{@meeting.id}#{ext}"
      end

      def peaks
        path = @meeting.audio_file_path

        unless audio_file_accessible?(path)
          render json: { error: "Audio not found" }, status: :not_found
          return
        end

        peaks_path = "#{path}.peaks.json"
        generate_peaks!(path, peaks_path) unless File.exist?(peaks_path)

        send_file peaks_path, type: "application/json", disposition: "inline"
      rescue StandardError => e
        Rails.logger.error "[AudioPeaks] #{e.message}"
        render json: { error: "Failed to generate peaks" }, status: :internal_server_error
      end

      private

      def valid_audio_content_type?(content_type)
        base_type = content_type.to_s.split(";").first.strip
        ALLOWED_AUDIO_CONTENT_TYPES.include?(base_type)
      end

      def parts_dir(meeting_id)
        File.join(audio_dir, "#{meeting_id}_parts")
      end

      # 기존 오디오가 있으면 ffmpeg로 병합, 없으면 단순 저장
      def save_or_merge_audio(audio_file, meeting)
        ext = File.extname(audio_file.original_filename).downcase.presence || ".webm"
        dest_path = File.join(audio_dir, "#{meeting.id}#{ext}")
        FileUtils.mkdir_p(audio_dir)

        existing = meeting.audio_file_path
        if existing.present? && File.exist?(existing)
          merge_audio_files(existing, audio_file.tempfile.path, dest_path)
        else
          FileUtils.cp(audio_file.tempfile.path, dest_path)
        end

        dest_path
      end

      def merge_audio_files(existing_path, new_path, output_path)
        merged_path = "#{output_path}.merged.webm"

        success = system(
          "ffmpeg", "-y",
          "-i", existing_path,
          "-i", new_path,
          "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
          "-c:a", "libopus",
          merged_path,
          out: File::NULL, err: File::NULL
        )

        unless success
          Rails.logger.error "[MeetingsAudio] ffmpeg merge failed, saving new segment only"
          FileUtils.cp(new_path, output_path)
          return
        end

        FileUtils.mv(merged_path, output_path)
      end

      def audio_file_accessible?(path)
        path.present? && File.exist?(path)
      end

      def generate_peaks!(audio_path, peaks_path)
        duration = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(audio_path)}`.strip.to_f

        raw = IO.popen(
          [ "ffmpeg", "-i", audio_path, "-ac", "1", "-ar", "100", "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1" ],
          "rb", err: File::NULL
        ) { |io| io.read }

        samples = raw.unpack("e*")
        target = 800
        chunk_size = [ (samples.length / target.to_f).ceil, 1 ].max
        peaks_data = samples.each_slice(chunk_size).map { |c| c.map(&:abs).max || 0.0 }

        max_val = peaks_data.max || 1.0
        peaks_data = peaks_data.map { |p| (p / max_val).round(4) } if max_val > 0

        File.write(peaks_path, JSON.generate({ peaks: [ peaks_data ], duration: duration }))
      end
    end
  end
end
