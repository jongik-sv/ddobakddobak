class MeetingBookmark < ApplicationRecord
  belongs_to :meeting

  validates :timestamp_ms, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
