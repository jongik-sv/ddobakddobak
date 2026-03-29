class User < ApplicationRecord
  has_many :team_memberships, dependent: :destroy
  has_many :teams, through: :team_memberships

  validates :name, presence: true

  before_validation :set_defaults, on: :create

  private

  def set_defaults
    self.encrypted_password = SecureRandom.hex(32) if encrypted_password.blank?
    self.jti = SecureRandom.uuid if jti.blank?
  end
end
