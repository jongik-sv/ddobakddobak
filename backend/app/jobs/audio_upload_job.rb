class AudioUploadJob < ApplicationJob
  queue_as :default

  # 음성용 mp3 비트레이트 (mono 64kbps면 회의 음성에 충분하고 WAV 대비 ~1/15)
  MP3_BITRATE = "64k".freeze

  def perform(meeting_id:)
    meeting = Meeting.find(meeting_id)
    src = meeting.audio_file_path
    return unless src.present? && File.exist?(src) && File.size(src) > 0

    # 이미 mp3면 변환 불필요
    return if File.extname(src).casecmp(".mp3").zero?

    mp3_path = "#{src.sub(/#{Regexp.escape(File.extname(src))}\z/, '')}.mp3"

    if transcode_to_mp3(src, mp3_path)
      meeting.update!(audio_file_path: mp3_path)
      cleanup_original(src)
      Rails.logger.info "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 완료 #{mp3_path}"
    else
      Rails.logger.error "[AudioUploadJob] meeting=#{meeting_id} mp3 변환 실패, 원본 유지 #{src}"
    end
  rescue ActiveRecord::RecordNotFound
    Rails.logger.error "[AudioUploadJob] Meeting not found: #{meeting_id}"
  end

  private

  def transcode_to_mp3(src, dest)
    ok = system(
      "ffmpeg", "-y", "-loglevel", "error",
      "-i", src,
      "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", MP3_BITRATE,
      dest
    )
    ok && File.exist?(dest) && File.size(dest) > 0
  end

  # 변환 성공 시 원본 오디오와 원본 기준 peaks 캐시를 제거 (peaks는 mp3 기준으로 재생성됨)
  def cleanup_original(src)
    File.delete(src) if File.exist?(src)
    old_peaks = "#{src}.peaks.json"
    File.delete(old_peaks) if File.exist?(old_peaks)
  end
end
