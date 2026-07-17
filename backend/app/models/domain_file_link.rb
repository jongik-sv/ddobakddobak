# 도메인 파일 "적용(링크)" — 프로젝트/폴더/회의 3레벨 owner에 파일을 연결한다.
# glossary_entry.rb의 belongs_to :owner, polymorphic 선례를 따른다.
class DomainFileLink < ApplicationRecord
  OWNER_TYPES = %w[Project Folder Meeting].freeze

  belongs_to :domain_file
  belongs_to :owner, polymorphic: true

  scope :not_excluded, -> { where(exclude: false) }
  scope :excluded, -> { where(exclude: true) }

  validates :owner_type, inclusion: { in: OWNER_TYPES }
  validates :domain_file_id, uniqueness: { scope: %i[owner_type owner_id] }
  # exclude(회의별 상속 제외 마커)는 Meeting owner에만 허용 — Folder/Project는 상속 개념이 없다.
  validate :exclude_only_allowed_for_meeting

  private

  def exclude_only_allowed_for_meeting
    return unless exclude
    errors.add(:exclude, "은 Meeting owner에만 허용됩니다") unless owner_type == "Meeting"
  end
end
