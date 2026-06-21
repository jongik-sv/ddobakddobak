# settings.yaml(sidecar 공유 런타임 설정) 읽기 헬퍼.
# SettingsController#app_settings 와 같은 파일을 읽는다.
class AppSettings
  # Api::V1::SettingsController::SETTINGS_PATH 와 동일 경로
  SETTINGS_PATH = Rails.root.join("..", "settings.yaml").to_s.freeze

  # 챗 사용성 판정용 정본 상수(부팅 안전 — User AR 모델은 초기화 중 autoload 불가).
  # User::CLI_LLM_PROVIDERS / User::CHAT_LOCAL_HOST_RE 가 이 둘을 별칭(alias)하여 단일 출처를 유지한다.
  # 키·base 불요 CLI 프로바이더 (LlmService::CLI_PROVIDERS 미러).
  CLI_LLM_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze
  # 로컬(loopback) base_url — 키 없이도 정당.
  CHAT_LOCAL_HOST_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i

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
  # 우선순위: llm.chat(독립 설정, 사용 가능할 때만) > 레거시 chat_model(모델만 override).
  # base_url 은 값이 있을 때만 포함한다(나머지는 런타임 시맨틱과 동일하게 항상 포함).
  CHAT_LLM_ENV_KEYS = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_MODEL CHAT_LLM_BASE_URL].freeze

  def self.chat_llm_env(llm_cfg)
    llm_cfg ||= {}
    chat = llm_cfg["chat"] || {}

    if chat["provider"].to_s.present?
      # 독립 챗 프로바이더 지정됨: 사용 가능하면 방출, 아니면 전면 억제(요약 폴백) — 레거시로 새지 않음.
      return {} unless chat_usable?(chat)

      env = {
        "CHAT_LLM_PROVIDER"   => chat["provider"].to_s,
        "CHAT_LLM_AUTH_TOKEN" => chat["auth_token"].to_s,
        "CHAT_LLM_MODEL"      => chat["model"].to_s
      }
      env["CHAT_LLM_BASE_URL"] = chat["base_url"].to_s if chat["base_url"].to_s.present?
      env
    elsif llm_cfg["chat_model"].present?
      { "CHAT_LLM_MODEL" => llm_cfg["chat_model"].to_s } # 순수 레거시(독립 프로바이더 없음)
    else
      {}
    end
  end

  # 전역 챗 독립 설정이 실제로 호출 가능한지 — User#chat_llm_configured? 와 동일 규약.
  #   클라우드(anthropic/openai 등)는 키가 있어야 인정. 키 없는 클라우드를 방출하면
  #   토큰리스 config 가 정상 폴백(요약 모델)을 우회해 401 이 난다.
  #   CLI 프로바이더와 로컬(loopback) base_url 은 키 없이도 정당.
  # 사용 불가 → 서브해시 미방출 → 부팅/런타임이 CHAT_LLM_* 를 비워둠 → 리졸버 tier-4(요약) 폴백.
  def self.chat_usable?(chat)
    return false if chat["provider"].to_s.blank?

    chat["auth_token"].to_s.present? ||
      CLI_LLM_PROVIDERS.include?(chat["provider"].to_s) ||
      chat["base_url"].to_s.match?(CHAT_LOCAL_HOST_RE)
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
