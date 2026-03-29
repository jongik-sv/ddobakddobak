class Tag < ApplicationRecord
  belongs_to :team
  has_many :taggings, dependent: :destroy

  validates :name, presence: true, length: { maximum: 30 }
  validates :name, uniqueness: { scope: :team_id }
  validates :color, presence: true

  scope :for_team, ->(team_ids) { where(team_id: team_ids) }
  scope :ordered, -> { order(:name) }
end
