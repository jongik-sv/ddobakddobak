class AddAudioDurationMsToMeetings < ActiveRecord::Migration[8.1]
  # serializer가 매 full show마다 동기 ffprobe(서브프로세스)로 오디오 길이를 재던 것을
  # 컬럼 캐시로 대체(읽기 핫패스에서 서브프로세스 제거). 값은 audio_file_path가 바뀌는
  # 모든 쓰기 지점에서 refresh_audio_duration!로 갱신되고, 레거시(nil)는 serializer가
  # 첫 조회 시 lazy 측정·캐시한다(완료 회의 파일은 불변이라 안전).
  def change
    add_column :meetings, :audio_duration_ms, :integer
  end
end
