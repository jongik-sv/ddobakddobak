# ── 오디오 길이 측정/캐시 ──
module Meeting::AudioDuration
  extend ActiveSupport::Concern

  # audio_file_path 파일의 길이(ms)를 ffprobe로 측정한다. 파일이 없으면 0.
  def measure_audio_duration_ms
    path = audio_file_path
    return 0 unless path.present? && File.exist?(path)

    output = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 #{Shellwords.escape(path)}`.strip
    (output.to_f * 1000).to_i
  rescue StandardError
    0
  end

  # 측정값을 audio_duration_ms 컬럼에 저장(콜백·검증 우회). audio_file_path가 바뀌는
  # 쓰기 지점에서 호출해 컬럼이 항상 현재 파일 길이를 반영하게 한다(merge로 path가
  # 그대로여도 내용이 커지므로 무조건 재측정한다).
  def refresh_audio_duration!
    update_column(:audio_duration_ms, measure_audio_duration_ms)
  end

  # audio_file_path를 바꾸는 모든 쓰기 지점의 단일 진입점. 경로를 저장(검증 실행)하고
  # 곧바로 길이를 재측정·캐시해 path↔duration 결합을 모델에서 강제한다(콜백 부재 →
  # 새 쓰기 지점이 refresh를 빠뜨리는 일 방지). 파일을 '비우는' reset 경로는 별개.
  def set_audio_file!(path)
    update!(audio_file_path: path)
    refresh_audio_duration!
  end
end
