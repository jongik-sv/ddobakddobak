class ChatMessage < ApplicationRecord
  belongs_to :meeting, optional: true
  belongs_to :user

  ROLES = %w[user assistant].freeze
  # "streaming" 은 stream_answer 가 델타 플러시마다 DB에도 저장한다(content 와 함께 update_columns).
  # DB가 pending 으로 남으면 폴링 재조회가 웹소켓으로 받은 streaming 본문을 pending 으로 덮어
  # "…답변 작성 중" 깜빡임이 생기기 때문. 완료/실패는 잡이 complete/error 로 전환한다.
  STATUSES = %w[pending streaming complete error].freeze
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
