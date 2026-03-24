class Transcript < ApplicationRecord
  belongs_to :meeting

  validates :content, presence: true
  validates :speaker_label, presence: true
  validates :started_at_ms, presence: true
  validates :ended_at_ms, presence: true
  validates :sequence_number, presence: true

  default_scope { order(:sequence_number) }
end
