# 외부 API(/api/ext) 호출 감사 로그. meeting_id는 의도적으로 FK가 없다 — 회의 삭제와
# 무관하게 "누가 언제 어떤 회의를 조회했는지" 기록을 보존한다.
class ApiTokenAuditLog < ApplicationRecord
  belongs_to :api_token

  validates :action, presence: true
end
