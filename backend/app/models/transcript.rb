class Transcript < ApplicationRecord
  belongs_to :meeting

  validates :content, presence: true
  validates :speaker_label, presence: true
  validates :started_at_ms, presence: true
  validates :ended_at_ms, presence: true
  validates :sequence_number, presence: true

  default_scope { order(:sequence_number) }

  def self.to_sidecar_payload(transcripts)
    transcripts.map do |t|
      { speaker: t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
    end
  end
end
