# 회의 오디오 원본을 ffmpeg 로 raw PCM(s16le, 16kHz mono)으로 변환하는 공유 헬퍼.
# FileTranscriptionJob / ReDiarizeJob 가 동일 로직을 사용한다.
module PcmConvertible
  private

  def convert_to_pcm(meeting)
    input_path = meeting.audio_file_path
    raise "오디오 파일이 없습니다" unless input_path.present? && File.exist?(input_path)

    pcm_path = input_path.sub(/\.[^.]+$/, "_pcm.raw")

    success = system(
      "ffmpeg", "-y",
      "-i", input_path,
      "-ar", "16000",
      "-ac", "1",
      "-f", "s16le",
      "-acodec", "pcm_s16le",
      pcm_path,
      out: File::NULL, err: File::NULL
    )
    raise "ffmpeg 변환 실패" unless success && File.exist?(pcm_path)

    pcm_path
  end
end
