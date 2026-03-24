class Summary < ApplicationRecord
  belongs_to :meeting

  validates :summary_type, presence: true, inclusion: { in: %w[realtime final] }
  validates :generated_at, presence: true
end
