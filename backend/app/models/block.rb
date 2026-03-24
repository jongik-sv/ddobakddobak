class Block < ApplicationRecord
  belongs_to :meeting
  belongs_to :parent_block, class_name: "Block", optional: true
  has_many :child_blocks, class_name: "Block", foreign_key: :parent_block_id, dependent: :destroy

  BLOCK_TYPES = %w[
    text
    heading1
    heading2
    heading3
    bullet_list
    numbered_list
    checkbox
    quote
    divider
  ].freeze

  validates :block_type, inclusion: { in: BLOCK_TYPES }
  validates :position, presence: true, numericality: { greater_than: 0 }
  validates :meeting_id, presence: true
  validate :parent_block_same_meeting

  scope :ordered, -> { order(:position) }

  private

  def parent_block_same_meeting
    return unless parent_block_id.present?
    return if meeting&.block_ids&.include?(parent_block_id)

    errors.add(:parent_block_id, "must belong to the same meeting")
  end
end
