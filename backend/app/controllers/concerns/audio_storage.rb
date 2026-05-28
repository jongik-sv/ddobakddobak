module AudioStorage
  extend ActiveSupport::Concern

  private

  # 오디오 저장 디렉터리. AUDIO_DIR 환경변수로 외부 경로 지정 가능.
  def audio_dir
    ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
  end
end
