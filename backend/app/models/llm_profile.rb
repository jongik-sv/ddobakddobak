class LlmProfile < ApplicationRecord
  PROVIDERS = %w[anthropic openai].freeze

  belongs_to :user, optional: true

  encrypts :auth_token

  validates :name, presence: true, uniqueness: { scope: :user_id }
  validates :preset_id, presence: true
  validates :provider, presence: true, inclusion: { in: PROVIDERS }

  before_destroy :detach_user_references

  scope :server_pool, -> { where(user_id: nil) }
  scope :personal_for, ->(user) { where(user_id: user.id) }

  # LlmService.new(llm_config:) 호환 해시
  def to_llm_config
    {
      provider: provider,
      auth_token: auth_token.presence,
      model: model.presence,
      base_url: base_url.presence
    }.compact
  end

  # 응답 직렬화 — 토큰 원문 대신 마스킹(masker = TokenMasking#mask_token 바인딩)
  def as_masked_json(masker)
    {
      id: id, name: name, preset_id: preset_id, provider: provider,
      base_url: base_url, model: model,
      max_input_tokens: max_input_tokens, max_output_tokens: max_output_tokens,
      has_token: auth_token.present?,
      auth_token_masked: auth_token.present? ? masker.call(auth_token) : nil
    }
  end

  # frontend llmServicePresets.presetIdFromUserConfig 미러 — 레거시 컬럼 → preset_id 복원(이관용)
  def self.preset_id_for(provider, base_url)
    b = base_url.to_s
    if provider == "anthropic"
      return "zai" if b.include?("z.ai")
      "anthropic"
    elsif provider == "openai"
      return "ollama" if b.include?("11434")
      return "lmstudio" if b.include?("1234")
      return "gemini" if b.include?("generativelanguage")
      return "custom" if b.present?
      "openai"
    else
      "anthropic"
    end
  end

  private

  def detach_user_references
    ::User.where(llm_profile_id: id).update_all(llm_profile_id: nil)
    ::User.where(chat_llm_profile_id: id).update_all(chat_llm_profile_id: nil)
  end
end
