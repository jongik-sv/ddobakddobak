# 레거시 LLM 설정(users 컬럼·settings.yaml presets)을 llm_profiles로 1회 이관.
# 멱등: users는 이관 시 레거시 컬럼을 클리어하므로 재실행 대상이 사라지고,
# 서버 풀은 (user_id: nil, name) find_or_create. CLI 설정은 프로필 대상이 아니므로 보존.
class LlmProfileLegacyImporter
  API_PROVIDERS = %w[anthropic openai].freeze
  PRESET_LABELS = {
    "anthropic" => "Anthropic", "zai" => "Z.AI", "openai" => "OpenAI",
    "gemini" => "Google Gemini", "ollama" => "Ollama", "lmstudio" => "LM Studio",
    "custom" => "직접 입력"
  }.freeze

  def self.run!
    import_users!
    import_server_yaml!
  end

  def self.import_users!
    ::User.where(llm_provider: API_PROVIDERS, llm_profile_id: nil).find_each do |u|
      next if u.llm_api_key.blank? && u.llm_base_url.blank?

      profile = create_personal!(u, u.llm_provider, u.llm_base_url, u.llm_model, u.llm_api_key)
      u.update!(llm_profile_id: profile.id, llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil)
    end

    ::User.where(chat_llm_provider: API_PROVIDERS, chat_llm_profile_id: nil).find_each do |u|
      next if u.chat_llm_api_key.blank? && u.chat_llm_base_url.blank?

      profile = create_personal!(u, u.chat_llm_provider, u.chat_llm_base_url, u.chat_llm_model, u.chat_llm_api_key)
      u.update!(chat_llm_profile_id: profile.id, chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_model: nil, chat_llm_base_url: nil)
    end
  end

  def self.create_personal!(user, provider, base_url, model, token)
    preset = LlmProfile.preset_id_for(provider, base_url)
    base_name = [ PRESET_LABELS.fetch(preset, preset), model.presence ].compact.join(" · ")
    name = base_name
    n = 2
    while LlmProfile.exists?(user_id: user.id, name: name)
      name = "#{base_name} (#{n})"
      n += 1
    end
    LlmProfile.create!(
      user_id: user.id, name: name, preset_id: preset, provider: provider,
      base_url: base_url.presence, model: model.presence, auth_token: token.presence
    )
  end

  def self.import_server_yaml!
    cfg = AppSettings.load
    llm = cfg["llm"]
    return if llm.blank?

    presets = llm["presets"] || {}
    created = {}
    presets.each do |preset_id, data|
      provider = data["provider"].to_s
      next unless API_PROVIDERS.include?(provider)

      created[preset_id] = LlmProfile.find_or_create_by!(user_id: nil, name: PRESET_LABELS.fetch(preset_id, preset_id)) do |p|
        p.preset_id = preset_id
        p.provider = provider
        p.base_url = data["base_url"].presence
        p.model = data["model"].presence
        p.auth_token = data["auth_token"].presence
        p.max_input_tokens = data["max_input_tokens"]
        p.max_output_tokens = data["max_output_tokens"]
      end
    end

    active = llm["active_preset"].to_s
    llm["active_profile_id"] = created[active].id if created[active] && llm["active_profile_id"].blank?

    chat = llm["chat"] || {}
    if API_PROVIDERS.include?(chat["provider"].to_s) && llm["chat_profile_id"].blank?
      chat_preset = chat["preset_id"].presence || LlmProfile.preset_id_for(chat["provider"], chat["base_url"])
      reusable = created[chat_preset]
      # 챗 블록 값이 프리셋 프로필과 완전히 일치할 때만 재사용. 하나라도 다르면(대표적으로
      # "같은 자격증명 + 더 작은 챗 모델" override) 전용 "(챗)" 프로필을 만들어 유실을 방지한다.
      unless reusable &&
             reusable.provider == chat["provider"].to_s &&
             reusable.base_url == chat["base_url"].presence &&
             reusable.model == chat["model"].presence &&
             reusable.auth_token == chat["auth_token"].presence
        reusable = nil
      end
      chat_profile = reusable || LlmProfile.find_or_create_by!(user_id: nil, name: "#{PRESET_LABELS.fetch(chat_preset, chat_preset)} (챗)") do |p|
        p.preset_id = chat_preset
        p.provider = chat["provider"]
        p.base_url = chat["base_url"].presence
        p.model = chat["model"].presence
        p.auth_token = chat["auth_token"].presence
      end
      llm["chat_profile_id"] = chat_profile.id
    end

    LlmProfileYamlSync.apply!(cfg)
    File.write(AppSettings::SETTINGS_PATH, YAML.dump(cfg.deep_stringify_keys))
  end
end
