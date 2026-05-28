class MeetingTemplate < ApplicationRecord
  # 회의 템플릿은 중앙 집중관리 — 전역 공유 (사용자 소유 없음).
  belongs_to :folder, optional: true

  validates :name, presence: true, length: { maximum: 100 }
end
