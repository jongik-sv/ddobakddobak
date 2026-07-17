class Project < ApplicationRecord
  include Trashable

  ICON_TYPES = %w[lucide emoji image].freeze

  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :project_memberships, dependent: :destroy
  has_many :members, through: :project_memberships, source: :user
  has_many :meetings, dependent: :restrict_with_error
  has_many :folders, dependent: :restrict_with_error
  has_many :project_invites, dependent: :destroy
  # project_id 로 이 프로젝트에 "생성 소속"된 도메인 파일(용어집) — project 삭제 시 nullify(전역 파일로 남음).
  # 아래 domain_file_links를 통한 "프로젝트에 적용(링크)된" domain_files 와는 별개 개념.
  has_many :owned_domain_files, class_name: "DomainFile", foreign_key: :project_id, dependent: :nullify
  has_many :domain_file_links, as: :owner, dependent: :destroy
  has_many :domain_files, through: :domain_file_links

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

  # 시스템 admin의 "모든 팀 프로젝트 접근" override가 이 프로젝트에는 적용되면 안 될 때 true.
  # 남의 개인 프로젝트(personal=true, 소유자 ≠ user)만 true — 그 외(팀 프로젝트, 본인 개인 프로젝트)는 false.
  def blocks_admin_override?(user)
    personal? && created_by_id != user&.id
  end
end
