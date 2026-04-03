class Decision < ApplicationRecord
  belongs_to :meeting

  validates :content, presence: true
  validates :status, inclusion: { in: %w[active revised cancelled] }
end
