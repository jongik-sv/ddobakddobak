class MeetingDomainFile < ApplicationRecord
  belongs_to :meeting
  belongs_to :domain_file

  validates :domain_file_id, uniqueness: { scope: :meeting_id }
end
