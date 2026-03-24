class ActionItem < ApplicationRecord
  belongs_to :meeting
  belongs_to :assignee, class_name: "User", optional: true

  validates :content, presence: true
  validates :status, inclusion: { in: %w[todo in_progress done] }
end
