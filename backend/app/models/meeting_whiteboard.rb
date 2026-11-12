# 서버 모드 화이트보드 생성 결과(회의당 1건, 최신본만 보관).
class MeetingWhiteboard < ApplicationRecord
  STATUSES = %w[running done error].freeze

  belongs_to :meeting
  belongs_to :requested_by, class_name: "::User", optional: true

  validates :status, inclusion: { in: STATUSES }

  def board
    return nil if board_json.blank?
    JSON.parse(board_json)
  rescue JSON::ParserError
    nil
  end
end
