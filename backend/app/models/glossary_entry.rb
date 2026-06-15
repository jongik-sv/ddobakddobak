class GlossaryEntry < ApplicationRecord
  MATCH_TYPES = %w[literal regex].freeze

  belongs_to :owner, polymorphic: true
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id, optional: true

  validates :from_text, presence: true, length: { maximum: 200 }
  validates :to_text, presence: true
  validates :match_type, inclusion: { in: MATCH_TYPES }
  validates :from_text, uniqueness: { scope: %i[owner_type owner_id match_type] }
  validate  :from_differs_from_to, if: -> { match_type == "literal" }
  validate  :regex_compiles, if: -> { match_type == "regex" }

  scope :active, -> { where(enabled: true) }

  private

  def from_differs_from_to
    errors.add(:to_text, "must differ from from_text") if from_text == to_text
  end

  def regex_compiles
    Regexp.new(from_text.to_s)
  rescue RegexpError => e
    errors.add(:from_text, "is not a valid regex: #{e.message}")
  end
end
