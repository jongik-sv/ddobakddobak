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
end
