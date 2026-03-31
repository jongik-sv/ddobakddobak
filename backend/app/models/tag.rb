class Tag < ApplicationRecord
  belongs_to :team, optional: true
  has_many :taggings, dependent: :destroy

  validates :name, presence: true, length: { maximum: 30 }
  validates :name, uniqueness: true
  validates :color, presence: true

  scope :ordered, -> { order(:name) }
end
