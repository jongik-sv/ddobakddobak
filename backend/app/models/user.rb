class User < ApplicationRecord
  # ── Devise ──
  include Devise::JWT::RevocationStrategies::JTIMatcher

  devise :database_authenticatable, :jwt_authenticatable,
         jwt_revocation_strategy: self

  has_many :project_memberships, dependent: :destroy
  has_many :projects, through: :project_memberships
  has_many :created_projects, class_name: "Project", foreign_key: :created_by_id, inverse_of: :creator
  has_many :meeting_participants, dependent: :destroy
  has_many :chat_messages, dependent: :destroy

  after_create { EnsurePersonalProject.call(self) }
  # 유저 삭제 시 본인 소유 "개인" 프로젝트(personal: true)만 정리한다.
  # personal 프로젝트는 멤버가 본인뿐이므로 안전하게 destroy 가능.
  # 한계: 유저가 만든 "공유" 프로젝트(personal: false)는 건드리지 않는다.
  #   projects.created_by_id FK 에 on_delete 가 없어, 그런 유저 삭제는 FK 위반(500)이 난다.
  #   (meetings.created_by_id 도 동일) — 공유 콘텐츠 소유자 삭제는 Phase 범위 밖, 별도 처리 필요.
  before_destroy { created_projects.where(personal: true).destroy_all }

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

  # LlmService::CLI_PROVIDERS 와 동일(키·base 불요 CLI 프로바이더). 모델 자기완결성 위해 미러.
  CLI_LLM_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze

  def llm_provider_cli?
    CLI_LLM_PROVIDERS.include?(llm_provider)
  end

  def llm_configured?
    llm_has_settings? && llm_enabled?
  end

  # 설정 자체가 존재하는지 (활성 여부와 무관)
  def llm_has_settings?
    llm_provider.present? && (llm_api_key.present? || llm_provider_cli?)
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

  # AI Chat용 LLM 설정. 우선순위:
  #   1) 개인 챗 설정(chat_llm_*) → 완전 독립
  #   2) 개인 요약 있음 → 요약 config + (chat_llm_model || ENV["CHAT_LLM_MODEL"]) 모델 override
  #   3) 전역 챗 설정(ENV["CHAT_LLM_PROVIDER"]) → 전역 독립
  #   4) 전역 요약 + ENV["CHAT_LLM_MODEL"] 모델 override
  def effective_chat_llm_config
    if chat_llm_configured?
      return {
        provider: chat_llm_provider,
        auth_token: chat_llm_api_key,
        model: chat_llm_model,
        base_url: chat_llm_base_url
      }.compact
    end

    if llm_configured?
      cfg = effective_llm_config
      chat_model = chat_llm_model.presence || ENV["CHAT_LLM_MODEL"].presence
      return chat_model ? cfg.merge(model: chat_model) : cfg
    end

    return self.class.server_default_chat_llm_config if ENV["CHAT_LLM_PROVIDER"].present?

    cfg = self.class.server_default_llm_config
    return cfg if cfg.blank?
    chat_model = ENV["CHAT_LLM_MODEL"].presence
    chat_model ? cfg.merge(model: chat_model) : cfg
  end

  # 전역(서버 기본) 챗 독립 config. ENV["CHAT_LLM_PROVIDER"] 가 있을 때만 의미.
  def self.server_default_chat_llm_config
    {
      provider:   ENV["CHAT_LLM_PROVIDER"],
      auth_token: ENV["CHAT_LLM_AUTH_TOKEN"],
      model:      ENV["CHAT_LLM_MODEL"],
      base_url:   ENV["CHAT_LLM_BASE_URL"]
    }.compact
  end

  # 챗 독립 설정 존재 여부.
  #   클라우드 프로바이더(anthropic/openai 등)는 키가 있어야 인정한다.
  #   키 없는 클라우드를 인정하면 effective_chat_llm_config tier-1이 토큰리스 config를
  #   반환해 정상 동작하는 tier-2(요약) 폴백을 우회하고 401이 난다.
  #   단, CLI 프로바이더와 로컬(loopback base_url) 프로바이더는 키 없이도 정당하게 인정한다.
  CHAT_LOCAL_HOST_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i

  def chat_llm_configured?
    return false if chat_llm_provider.blank?

    chat_llm_api_key.present? ||
      CLI_LLM_PROVIDERS.include?(chat_llm_provider) ||
      chat_llm_base_url.to_s.match?(CHAT_LOCAL_HOST_RE)
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
