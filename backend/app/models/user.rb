class User < ApplicationRecord
  validates :name, presence: true

  before_validation :set_defaults, on: :create

  private

  def set_defaults
    self.encrypted_password = SecureRandom.hex(32) if encrypted_password.blank?
    self.jti = SecureRandom.uuid if jti.blank?
  end
end
