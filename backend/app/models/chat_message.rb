class ChatMessage < ApplicationRecord
  belongs_to :meeting, optional: true
  belongs_to :user

  ROLES = %w[user assistant].freeze
  STATUSES = %w[pending complete error].freeze
  SCOPE_TYPES = %w[meeting folder project].freeze

  # model_name 은 ActiveRecord 예약 메서드명과 충돌하나, LLM 모델명 저장 컬럼으로 명시 허용한다.
  def self.dangerous_attribute_method?(name)
    return false if name.to_s == "model_name"
    super
  end

  validates :role, inclusion: { in: ROLES }
  validates :status, inclusion: { in: STATUSES }
  validates :scope_type, inclusion: { in: SCOPE_TYPES }
  validates :content, presence: true, if: -> { role == "user" }

  scope :for_user, ->(user) { where(user: user) }
  scope :for_scope, ->(type, id) { where(scope_type: type, scope_id: id) }
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
