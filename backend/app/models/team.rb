class Team < ApplicationRecord
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :team_memberships, dependent: :destroy
  has_many :members, through: :team_memberships, source: :user
  has_many :meetings, dependent: :destroy

  validates :name, presence: true
end
