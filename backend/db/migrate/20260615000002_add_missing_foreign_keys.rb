class AddMissingForeignKeys < ActiveRecord::Migration[8.1]
  # 누락 FK 보강(#11). 대상 5개는 모두 orphan 0 검증됨(2026-06-15) → 무손실 추가.
  # on_delete는 기존 Rails `dependent:` 동작을 정확히 미러링 → 기능·동작 변경 0,
  # DB 레벨 무결성만 강제(앱 콜백 우회 삭제 시에도 일관성 유지).
  #
  # 결정 필요 FK는 제외: transcripts/summaries(garbage orphan 정리 선행),
  # meetings.created_by_id / teams.created_by_id(창작자 없는 실데이터 처리 결정 필요).
  def change
    # Team has_many :meetings, dependent: :destroy → cascade
    add_foreign_key :meetings, :teams, column: :team_id, on_delete: :cascade
    # belongs_to :folder, optional: true → nullify
    add_foreign_key :meetings, :folders, column: :folder_id, on_delete: :nullify
    # belongs_to :previous_meeting, optional(self-ref) → nullify
    add_foreign_key :meetings, :meetings, column: :previous_meeting_id, on_delete: :nullify
    # Team has_many :team_memberships, dependent: :destroy → cascade
    add_foreign_key :team_memberships, :teams, column: :team_id, on_delete: :cascade
    # User has_many :team_memberships, dependent: :destroy → cascade
    add_foreign_key :team_memberships, :users, column: :user_id, on_delete: :cascade
  end
end
