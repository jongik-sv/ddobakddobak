# 비-텍스트 안건 첨부를 추출(AgendaExtractionService)한 뒤, 회의 단위 압축 재계산(AgendaReferenceJob)을
# 체이닝한다. 추출 실패해도 RefJob 은 돌려 나머지 안건으로 부분 반영(무음손실 차단).
class AgendaExtractionJob < ApplicationJob
  queue_as :default

  def perform(attachment_id)
    attachment = MeetingAttachment.find_by(id: attachment_id)
    return unless attachment&.category == "agenda" && attachment.file?

    begin
      AgendaExtractionService.new(attachment).call
    rescue => e
      Rails.logger.error "[AgendaExtractionJob] attachment=#{attachment_id} error=#{e.class}: #{e.message}"
    end

    AgendaReferenceJob.perform_later(attachment.meeting_id)
  end
end
