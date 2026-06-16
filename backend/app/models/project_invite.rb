class ProjectInvite < ApplicationRecord
  belongs_to :project
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id

  validates :code, presence: true, uniqueness: true

  # created_by: 인자는 creator 연관(FK created_by_id)으로 저장된다.
  def self.generate!(project:, created_by:, expires_at: nil, max_uses: nil)
    create!(
      project: project,
      creator: created_by,
      code: unique_code,
      expires_at: expires_at,
      max_uses: max_uses
    )
  end

  def self.unique_code
    loop do
      code = SecureRandom.alphanumeric(6)
      return code unless exists?(code: code)
    end
  end

  def redeemable?
    return false if expires_at && expires_at < Time.current
    return false if max_uses && use_count >= max_uses
    true
  end

  def consume!
    increment!(:use_count)
  end
end
