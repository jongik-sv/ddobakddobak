class Project < ApplicationRecord
  include Trashable

  ICON_TYPES = %w[lucide emoji image].freeze

  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :project_memberships, dependent: :destroy
  has_many :members, through: :project_memberships, source: :user
  has_many :meetings, dependent: :restrict_with_error
  has_many :folders, dependent: :restrict_with_error
  has_many :project_invites, dependent: :destroy

  validates :name, presence: true
  validates :icon_type, inclusion: { in: ICON_TYPES }, allow_nil: true

  def deletable?
    !personal? && meetings.none? && folders.none?
  end

  def member?(user)
    return false unless user
    project_memberships.exists?(user_id: user.id)
  end

  def admin?(user)
    return false unless user
    project_memberships.exists?(user_id: user.id, role: "admin")
  end
end
