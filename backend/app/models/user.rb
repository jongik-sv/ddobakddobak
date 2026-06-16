class User < ApplicationRecord
  # ── Devise ──
  include Devise::JWT::RevocationStrategies::JTIMatcher

  devise :database_authenticatable, :jwt_authenticatable,
         jwt_revocation_strategy: self

  has_many :team_memberships, dependent: :destroy
  has_many :teams, through: :team_memberships
  has_many :meeting_participants, dependent: :destroy
  has_many :chat_messages, dependent: :destroy

  ROLES = %w[admin member].freeze
  LOCAL_EMAIL = "desktop@local".freeze

  validates :name, presence: true
  validates :role, inclusion: { in: ROLES }
  validates :password, length: { minimum: 6 }, if: -> { password.present? }

  encrypts :llm_api_key

  def admin?
    role == "admin"
  end

  def member?
    role == "member"
  end

  # 로컬 자동로그인 계정(desktop@local) 여부
  def local_account?
    email == LOCAL_EMAIL
  end

  def llm_configured?
    llm_provider.present? && llm_api_key.present? && llm_enabled?
  end

  # 설정 자체가 존재하는지 (활성 여부와 무관)
  def llm_has_settings?
    llm_provider.present? && llm_api_key.present?
  end

  def effective_llm_config
    if llm_configured?
      {
        provider: llm_provider,
        auth_token: llm_api_key,
        model: llm_model,
        base_url: llm_base_url
      }.compact
    else
      self.class.server_default_llm_config
    end
  end

  # AI Chat용 LLM 설정. 요약과 같은 provider/key를 쓰되, 채팅 모델을 덮어쓴다.
  # 우선순위: 사용자 개인 chat_llm_model(컬럼) > 전역 ENV["CHAT_LLM_MODEL"] > 요약 모델.
  # 모두 비어 있으면 요약 모델(effective_llm_config)로 폴백한다.
  def effective_chat_llm_config
    cfg = effective_llm_config
    return cfg if cfg.blank?

    chat_model = chat_llm_model.presence || ENV["CHAT_LLM_MODEL"].presence
    chat_model ? cfg.merge(model: chat_model) : cfg
  end

  # 사용자 개인 LLM 설정을 sidecar llm_config 형식으로 반환한다.
  # 개인 설정이 없으면 nil을 반환하여 sidecar가 서버 기본값을 사용하도록 한다.
  def sidecar_llm_config
    return nil unless llm_configured?

    {
      provider: llm_provider,
      auth_token: llm_api_key,
      model: llm_model,
      base_url: llm_base_url
    }.compact
  end

  # ── 회의 언어 설정 (사용자 개인) ──

  def selected_languages_list
    (selected_languages || "").split(",").map(&:strip).reject(&:blank?)
  end

  def language_configured?
    selected_languages_list.any?
  end

  # 회의 언어 설정을 {mode:, languages:} 형식으로 반환한다.
  # 개인 설정이 없으면 서버 기본값으로 폴백한다.
  def effective_language_config
    if language_configured?
      { mode: language_mode.presence || "single", languages: selected_languages_list }
    else
      self.class.server_default_language_config
    end
  end

  def self.server_default_language_config
    langs = ENV.fetch("SELECTED_LANGUAGES", "ko").split(",").map(&:strip).reject(&:blank?)
    langs = %w[ko] if langs.empty?
    { mode: ENV.fetch("LANGUAGE_MODE", "single"), languages: langs }
  end

  def self.server_default_llm_config
    provider = ENV.fetch("LLM_PROVIDER", "anthropic")
    {
      provider: provider,
      auth_token: provider == "openai" ? ENV["OPENAI_API_KEY"] : ENV["ANTHROPIC_AUTH_TOKEN"],
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

  # 모든 세션 무효화: jti 회전 → 기존 access token 거부, refresh_token_jti 제거 → refresh 거부
  def invalidate_all_sessions!
    update!(jti: SecureRandom.uuid, refresh_token_jti: nil)
  end
end
