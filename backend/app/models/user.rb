class User < ApplicationRecord
  # ── Devise ──
  include Devise::JWT::RevocationStrategies::JTIMatcher

  devise :database_authenticatable, :jwt_authenticatable,
         jwt_revocation_strategy: self

  has_many :team_memberships, dependent: :destroy
  has_many :teams, through: :team_memberships

  validates :name, presence: true

  # ── LLM 설정 ──
  encrypts :llm_api_key

  # 사용자에게 개인 LLM 설정이 있는지 여부
  def llm_configured?
    llm_provider.present? && llm_api_key.present?
  end

  # 유효한 LLM 설정 해시 반환 (개인 설정 우선, 없으면 서버 기본값)
  def effective_llm_config
    if llm_configured?
      {
        provider: llm_provider,
        api_key: llm_api_key,
        model: llm_model,
        base_url: llm_base_url
      }.compact
    else
      self.class.server_default_llm_config
    end
  end

  # 서버 기본 LLM 설정 (settings.yaml → ENV)
  def self.server_default_llm_config
    provider = ENV.fetch("LLM_PROVIDER", "anthropic")
    {
      provider: provider,
      api_key: provider == "openai" ? ENV["OPENAI_API_KEY"] : ENV["ANTHROPIC_AUTH_TOKEN"],
      model: ENV["LLM_MODEL"],
      base_url: provider == "openai" ? ENV["OPENAI_BASE_URL"] : ENV["ANTHROPIC_BASE_URL"]
    }.compact
  end

  # Refresh Token jti management
  def generate_refresh_token_jti!
    update!(refresh_token_jti: SecureRandom.uuid)
    refresh_token_jti
  end

  def revoke_refresh_token!
    update!(refresh_token_jti: nil)
  end
end
