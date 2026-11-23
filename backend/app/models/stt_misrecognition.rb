class SttMisrecognition < ApplicationRecord
  STATUSES = %w[confirmed undecided excluded].freeze

  belongs_to :project
  belongs_to :first_meeting, class_name: "Meeting", optional: true
  belongs_to :last_meeting, class_name: "Meeting", optional: true

  validates :status, inclusion: { in: STATUSES }

  scope :confirmed, -> { where(status: "confirmed") }
  scope :undecided, -> { where(status: "undecided") }
  scope :excluded, -> { where(status: "excluded") }
end
