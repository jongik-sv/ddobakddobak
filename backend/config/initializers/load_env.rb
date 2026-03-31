# settings.yaml에서 환경 변수를 로드한다.
# 이미 설정된 ENV 값은 덮어쓰지 않는다 (Tauri 등에서 직접 전달한 값 우선).
require "yaml"

settings_path = Rails.root.join("..", "settings.yaml")

if File.exist?(settings_path)
  begin
    cfg = YAML.safe_load(File.read(settings_path)) || {}

    # STT
    ENV["STT_ENGINE"] ||= cfg.dig("stt", "engine").to_s if cfg.dig("stt", "engine")

    # HuggingFace
    ENV["HF_TOKEN"] ||= cfg.dig("hf", "token").to_s if cfg.dig("hf", "token")

    # LLM — 활성 프리셋에서 로드
    llm = cfg["llm"] || {}
    active_id = llm["active_preset"]
    preset = llm.dig("presets", active_id) || {}
    provider = preset["provider"] || "anthropic"

    ENV["LLM_PROVIDER"] ||= provider
    ENV["LLM_MODEL"] ||= preset["model"].to_s if preset["model"]
    ENV["LLM_MAX_INPUT_TOKENS"] ||= (preset["max_input_tokens"] || 200_000).to_s
    ENV["LLM_MAX_OUTPUT_TOKENS"] ||= (preset["max_output_tokens"] || 10_000).to_s

    if provider == "openai"
      ENV["OPENAI_API_KEY"] ||= preset["auth_token"].to_s if preset["auth_token"]
      ENV["OPENAI_BASE_URL"] ||= preset["base_url"].to_s if preset["base_url"]
    else
      ENV["ANTHROPIC_AUTH_TOKEN"] ||= preset["auth_token"].to_s if preset["auth_token"]
      ENV["ANTHROPIC_BASE_URL"] ||= preset["base_url"].to_s if preset["base_url"]
    end

    # Summary
    ENV["SUMMARY_INTERVAL_SEC"] ||= cfg.dig("summary", "interval_sec").to_s if cfg.dig("summary", "interval_sec")

    # Languages
    if (langs = cfg.dig("languages", "selected"))
      ENV["SELECTED_LANGUAGES"] ||= langs.join(",")
    end

    # Diarization
    if (diar = cfg["diarization"])
      ENV["DIARIZATION_ENABLED"] ||= diar["enabled"].to_s unless diar["enabled"].nil?
      %w[similarity_threshold merge_threshold max_embeddings_per_speaker].each do |k|
        ENV["DIARIZATION_#{k.upcase}"] ||= diar[k].to_s if diar[k]
      end
    end

    # Audio
    if (audio = cfg["audio"])
      %w[silence_threshold speech_threshold silence_duration_ms max_chunk_sec min_chunk_sec preroll_ms overlap_ms file_chunk_sec].each do |k|
        ENV["AUDIO_#{k.upcase}"] ||= audio[k].to_s if audio[k]
      end
    end

  rescue Psych::SyntaxError => e
    Rails.logger.warn "[load_env] settings.yaml parse error: #{e.message}"
  end
end

# fallback: .env 파일도 로드 (하위 호환)
env_path = Rails.root.join("..", ".env")
if File.exist?(env_path)
  File.readlines(env_path).each do |line|
    line = line.strip
    next if line.empty? || line.start_with?("#")

    key, value = line.split("=", 2)
    next unless key && value

    key = key.strip
    value = value.strip
    value = value[1..-2] if (value.start_with?('"') && value.end_with?('"')) ||
                            (value.start_with?("'") && value.end_with?("'"))

    ENV[key] ||= value
  end
end
