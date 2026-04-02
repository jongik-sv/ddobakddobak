class MeetingParticipant < ApplicationRecord
  belongs_to :meeting
  belongs_to :user

  validates :role, inclusion: { in: %w[host viewer] }
  validates :user_id, uniqueness: {
    scope: :meeting_id,
    conditions: -> { where(left_at: nil) },
    message: "is already an active participant in this meeting"
  }

  scope :active, -> { where(left_at: nil) }
  scope :host, -> { where(role: "host") }

  after_create_commit :broadcast_participant_joined
  after_update_commit :broadcast_participant_left, if: -> { saved_change_to_left_at? && left_at.present? }

  # 참여자 정보를 JSON-serializable 해시로 변환 (단일 직렬화 경로)
  def as_summary
    {
      id: id,
      user_id: user_id,
      user_name: user.name,
      role: role,
      joined_at: joined_at
    }
  end

  private

  def broadcast_participant_joined
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      as_summary.merge(type: "participant_joined", participant_id: id)
    )
  end

  def broadcast_participant_left
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      {
        type: "participant_left",
        user_id: user_id,
        user_name: user.name
      }
    )
  end
end
