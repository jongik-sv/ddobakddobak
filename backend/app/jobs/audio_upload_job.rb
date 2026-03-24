class AudioUploadJob < ApplicationJob
  queue_as :default

  def perform(meeting_id:)
    meeting = Meeting.find(meeting_id)
    return unless meeting.audio_file_path.present?

    Rails.logger.info "[AudioUploadJob] Audio ready for meeting=#{meeting_id} path=#{meeting.audio_file_path}"
    # 후처리 확장 포인트:
    # - 향후 트랜스크립션 완료 후 오디오가 없는 경우 재트리거
    # - 파일 유효성 검증 (크기, 재생 시간 등)
  rescue ActiveRecord::RecordNotFound
    Rails.logger.error "[AudioUploadJob] Meeting not found: #{meeting_id}"
  end
end
