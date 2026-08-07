# 순수 claim 시퀀스 — MeetingDflowController#claim 과 DflowAutoLinkService#perform_claim 이
# 공유하는 동일 로직(발급 순서·external_id 조립·dflow_url 조립)을 단일 출처로 추출.
#
# 인가(editable_by? 등)·에러 처리(대상별 rescue 범위 다름)는 각 호출부 책임으로 남긴다 —
# 여기는 순수 claim 동작만: ensure_dflow_public_uid! → link_minute → dflow_url 조립·저장.
#
# 발급 순서 불변 규칙은 Meeting#ensure_dflow_public_uid! 단일 소스에 위임한다
# (DflowUploadService#call 과도 로직 공유 — 두 곳에 흩어지면 한쪽만 수정될 위험이 있다).
class DflowClaimer
  # @param meeting [Meeting]
  # @param minute_id [String] D'Flow minute id
  # @param user_email [String]
  # @param client [DflowClient] 기본은 새 인스턴스(호출부가 재사용 인스턴스를 넘길 수도 있음)
  # @return [Hash] { dflow_url:, external_id: } (meeting.dflow_url 에도 저장됨)
  def self.call(meeting:, minute_id:, user_email:, client: DflowClient.new)
    meeting.ensure_dflow_public_uid! # 이미 있으면 재사용(신규 발급 금지)
    external_id = "ddobak:#{meeting.public_uid}"

    resp = client.link_minute(minute_id: minute_id, external_id: external_id, user_email: user_email)
    # link 응답(계약 §4b)엔 url 필드가 없어 upload 응답(§4.3)과 동일한 규칙으로 직접 조립한다.
    dflow_url = "#{client.base_url}/minutes/#{resp['id']}"
    meeting.update!(dflow_url: dflow_url) # dflow_synced_at은 건드리지 않는다(claim은 전송이 아님)

    { dflow_url: dflow_url, external_id: external_id }
  end
end
