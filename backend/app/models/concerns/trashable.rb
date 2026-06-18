module Trashable
  extend ActiveSupport::Concern

  included do
    scope :kept, -> { where(deleted_at: nil) }
    scope :trashed, -> { where.not(deleted_at: nil) }
  end

  def trashed?
    deleted_at.present?
  end

  def soft_delete!(by:, group:, root: false)
    update_columns(
      deleted_at: Time.current,
      deleted_by_id: by&.id,
      trash_group_id: group,
      trashed_as_root: root
    )
  end

  def restore!
    update_columns(
      deleted_at: nil,
      deleted_by_id: nil,
      trash_group_id: nil,
      trashed_as_root: false
    )
  end
end
