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

  # 세컨드 브레인 외부 API(Ext::V1::MeetingNotesController)가 남긴 노트의 source 값.
  # 회의 화면의 일반 사용자 블록(source: "user")과 같은 테이블에 섞이되 출처를 구분한다.
  EXT_API_SOURCE = "ext_api".freeze

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
