# settings.yaml(sidecar 공유 런타임 설정) 읽기 헬퍼.
# SettingsController#app_settings 와 같은 파일을 읽는다.
class AppSettings
  # Api::V1::SettingsController::SETTINGS_PATH 와 동일 경로
  SETTINGS_PATH = Rails.root.join("..", "settings.yaml").to_s.freeze

  # sidecar 코드 기본값과 동일 (community-1 기준)
  DIARIZATION_DEFAULTS = {
    "enable" => false,
    "ahc_threshold" => 0.3,
    "clustering_threshold" => 0.6,
    "similarity_threshold" => 0.35,
    "merge_threshold" => 0.5,
    "max_embeddings_per_speaker" => 15
  }.freeze

  def self.load
    return {} unless File.exist?(SETTINGS_PATH)
    YAML.safe_load(File.read(SETTINGS_PATH)) || {}
  rescue => e
    Rails.logger.error "[AppSettings] settings.yaml 로드 실패: #{e.message}"
    {}
  end

  # 전역 AI Chat 설정을 CHAT_LLM_* ENV 페어(Hash)로 변환한다.
  # 두 호출부가 공유한다 — 갈라지면 부팅 후 챗 설정이 ENV에서 누락되는 버그가 재발한다:
  #   - config/initializers/load_env.rb (부팅, ||= 로 적용 — 미리 주입된 ENV 보존)
  #   - Api::V1::SettingsController#sync_active_llm_to_env (런타임 저장, = 로 적용 + 누락 키 삭제)
  # 우선순위: llm.chat(독립 설정) > 레거시 chat_model(모델만 override).
  # base_url 은 값이 있을 때만 포함한다(나머지는 런타임 시맨틱과 동일하게 항상 포함).
  CHAT_LLM_ENV_KEYS = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL].freeze

  def self.chat_llm_env(llm_cfg)
    llm_cfg ||= {}
    chat = llm_cfg["chat"] || {}

    if chat["provider"].to_s.present?
      env = {
        "CHAT_LLM_PROVIDER"   => chat["provider"].to_s,
        "CHAT_LLM_AUTH_TOKEN" => chat["auth_token"].to_s,
        "CHAT_LLM_MODEL"      => chat["model"].to_s
      }
      env["CHAT_LLM_BASE_URL"] = chat["base_url"].to_s if chat["base_url"].to_s.present?
      env
    elsif llm_cfg["chat_model"].present?
      { "CHAT_LLM_MODEL" => llm_cfg["chat_model"].to_s }
    else
      {}
    end
  end

  def self.diarization_config
    d = load["diarization"] || {}
    {
      "enable" => d.key?("enabled") ? !!d["enabled"] : DIARIZATION_DEFAULTS["enable"],
      "ahc_threshold" => (d["ahc_threshold"] || DIARIZATION_DEFAULTS["ahc_threshold"]).to_f,
      "clustering_threshold" => (d["clustering_threshold"] || DIARIZATION_DEFAULTS["clustering_threshold"]).to_f,
      "similarity_threshold" => (d["similarity_threshold"] || DIARIZATION_DEFAULTS["similarity_threshold"]).to_f,
      "merge_threshold" => (d["merge_threshold"] || DIARIZATION_DEFAULTS["merge_threshold"]).to_f,
      "max_embeddings_per_speaker" => (d["max_embeddings_per_speaker"] || DIARIZATION_DEFAULTS["max_embeddings_per_speaker"]).to_i
    }
  end
end
