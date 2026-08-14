# 비-텍스트 이해관계자 첨부를 추출(AgendaExtractionService 재사용 — 카테고리에 무관하게
# content_type 기반으로 동작하므로 파라미터화 없이 그대로 재사용 가능)한 뒤, 회의 단위 압축
# 재계산(StakeholderReferenceJob)을 체이닝한다. 추출 실패해도 RefJob 은 돌려 나머지 이해관계자
# 자료로 부분 반영(무음손실 차단). AgendaExtractionJob 미러.
class StakeholderExtractionJob < ApplicationJob
  queue_as :default

  def perform(attachment_id)
    attachment = MeetingAttachment.find_by(id: attachment_id)
    return unless attachment&.category == "stakeholder" && attachment.file?

    begin
      AgendaExtractionService.new(attachment).call
    rescue => e
      Rails.logger.error "[StakeholderExtractionJob] attachment=#{attachment_id} error=#{e.class}: #{e.message}"
    end

    StakeholderReferenceJob.perform_later(attachment.meeting_id)
  end
end
