class User < ApplicationRecord
  include Devise::JWT::RevocationStrategies::JTIMatcher

  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: self

  has_many :team_memberships, dependent: :destroy
  has_many :teams, through: :team_memberships

  validates :name, presence: true
end
