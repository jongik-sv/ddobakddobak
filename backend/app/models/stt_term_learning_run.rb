class SttTermLearningRun < ApplicationRecord
  TRIGGERS = %w[idle pre_overwrite manual].freeze
  STATUSES = %w[queued running done failed reverted].freeze

  belongs_to :meeting
  belongs_to :summary, optional: true
  has_many :items, class_name: "SttTermLearningItem", foreign_key: :run_id, dependent: :delete_all

  validates :trigger, inclusion: { in: TRIGGERS }
  validates :status, inclusion: { in: STATUSES }
end
