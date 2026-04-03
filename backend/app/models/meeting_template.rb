class MeetingTemplate < ApplicationRecord
  belongs_to :user
  belongs_to :folder, optional: true

  validates :name, presence: true, length: { maximum: 100 }
end
