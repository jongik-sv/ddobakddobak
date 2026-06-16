class ChatMessage < ApplicationRecord
  belongs_to :meeting
  belongs_to :user

  ROLES = %w[user assistant].freeze
  STATUSES = %w[pending complete error].freeze

  validates :role, inclusion: { in: ROLES }
  validates :status, inclusion: { in: STATUSES }
  validates :content, presence: true, if: -> { role == "user" }

  scope :for_user, ->(user) { where(user: user) }
  default_scope { order(:created_at) }

  # 어시스턴트 답변 뒤에 따라붙는 예상질문(한국어). 항상 문자열 배열, 최대 3개.
  def suggestions
    parsed = JSON.parse(suggestions_json)
    return [] unless parsed.is_a?(Array)

    parsed.first(3).map(&:to_s)
  rescue JSON::ParserError, TypeError
    []
  end

  def suggestions=(value)
    arr = value.is_a?(Array) ? value.first(3).map(&:to_s) : []
    self.suggestions_json = arr.to_json
  end
end
