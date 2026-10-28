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

  # settings.yaml 원자적 저장. 같은 디렉터리의 tmp 파일에 쓴 뒤 rename 한다(같은 FS 라 원자적).
  # 잡 워커(별도 프로세스)가 쓰기 도중의 반쪽 파일을 읽어 load 가 {} 를 돌려주는 일을 막는다.
  # 직렬화 형식은 기존 호출부와 동일(YAML.dump(cfg.deep_stringify_keys)).
  def self.save!(cfg)
    tmp = "#{SETTINGS_PATH}.tmp.#{Process.pid}.#{SecureRandom.hex(4)}"
    begin
      File.write(tmp, YAML.dump(cfg.deep_stringify_keys))
      # 토큰이 들어 있는 파일이라 기존 권한을 보존한다(없으면 기본 umask).
      File.chmod(File.stat(SETTINGS_PATH).mode & 0o7777, tmp) if File.exist?(SETTINGS_PATH)
      File.rename(tmp, SETTINGS_PATH)
    ensure
      File.delete(tmp) if File.exist?(tmp)
    end
  end

  # ── 워커 프로세스 ENV 재동기화 ──
  # SOLID_QUEUE_IN_PUMA=1 이면 잡 워커는 부팅 때 puma 에서 fork 된 별도 프로세스라,
  # 컨트롤러의 sync_env_from!(puma ENV 갱신)이 워커에 전달되지 않는다.
  # 잡 시작 시(ApplicationJob before_perform) settings.yaml 의 (mtime, size) 가 기준값과
  # 다르면 ENV 를 다시 동기화한다. 확인+동기화는 스레드 안전(Monitor — 재진입 가능한 뮤텍스).
  ENV_SYNC_MONITOR = Monitor.new
  @env_stamp = nil

  # settings.yaml 의 현재 (mtime, size). 파일이 없거나 stat 실패면 nil.
  def self.settings_stamp
    st = File.stat(SETTINGS_PATH)
    [ st.mtime.to_r, st.size ]
  rescue SystemCallError
    nil
  end

  # 현재 파일 상태를 "ENV 에 반영됨" 기준값으로 기록한다.
  # load_env.rb 가 부팅 시점(워커 fork 전)에 호출한다 — 기준값이 fork 되어 워커로 상속되므로,
  # 첫 잡이 무조건 재동기화(= 로 Tauri 등 외부 주입 ENV 를 덮어씀)하는 일이 없다.
  def self.mark_env_synced!
    ENV_SYNC_MONITOR.synchronize { @env_stamp = settings_stamp }
  end

  # 테스트용 — 기준값 초기화.
  def self.reset_env_sync_state!
    ENV_SYNC_MONITOR.synchronize { @env_stamp = nil }
  end

  # settings.yaml 이 기준값과 달라졌을 때만 sync_env_from! 으로 ENV 를 갱신한다.
  # 안전장치: 파일 없음 / load 가 {}(파싱 실패 포함) / llm 이 Hash 아님 → 동기화·기준값 갱신 모두 안 함
  #   (반쪽·깨진 파일 때문에 정상 ENV 가 날아가지 않게 하고, 정상 파일이 되면 그때 동기화).
  # 기준값 nil(부팅 때 파일 없음)이어도 현재 파일이 존재하면 동기화한다 — 외부 주입 ENV 가
  #   보존 대상이던 부팅 로드가 일어난 적이 없으므로 덮어써도 잃을 것이 없다.
  # 예외는 로그만 남기고 삼킨다(잡을 실패시키지 않음).
  def self.refresh_env_if_changed!
    ENV_SYNC_MONITOR.synchronize do
      stamp = settings_stamp
      next if stamp.nil? || stamp == @env_stamp

      cfg = load
      next if cfg.blank? || !cfg["llm"].is_a?(Hash)

      sync_env_from!(cfg)
      @env_stamp = stamp # sync_env_from! 이 갱신한 값보다 load 이전에 잰 stamp 가 안전(그 사이 변경 시 재동기화)
      Rails.logger.info "[AppSettings] settings.yaml 변경 감지 — ENV 재동기화"
    end
  rescue => e
    Rails.logger.error "[AppSettings] ENV 재동기화 실패: #{e.class}: #{e.message}"
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

  # SettingsController#sync_active_llm_to_env 본문의 verbatim move(cfg 인자화만) — 동작 변경 금지.
  # 예외: idea.md 37(서버 LLM "선택 안함") — active_preset=="none" 특수처리만 추가됨.
  def self.sync_env_from!(cfg)
    llm = cfg["llm"] || {}
    active_id = llm["active_preset"]
    preset = llm.dig("presets", active_id) || {}
    # "선택 안함"은 presets 에 엔트리가 없으므로(만들지 않음) 아래 preset["provider"] 폴백이
    # none 을 anthropic 으로 둔갑시키는 함정을 active_id 선검사로 차단한다(idea.md 37).
    none_selected = active_id == "none"
    provider = none_selected ? "none" : (preset["provider"] || "anthropic")

    ENV["STT_ENGINE"] = cfg.dig("stt", "engine").to_s if cfg.dig("stt", "engine")
    ENV["HF_TOKEN"] = cfg.dig("hf", "token").to_s if cfg.dig("hf", "token")

    ENV["LLM_PROVIDER"] = provider
    if none_selected
      ENV.delete("LLM_MODEL") # 이전 활성 프리셋의 모델이 잔류하지 않게 명시 삭제
    else
      ENV["LLM_MODEL"] = preset["model"].to_s if preset["model"]
    end
    ENV["LLM_MAX_INPUT_TOKENS"] = (preset["max_input_tokens"] || 200_000).to_s
    ENV["LLM_MAX_OUTPUT_TOKENS"] = (preset["max_output_tokens"] || 10_000).to_s

    # 전역 AI Chat. 매핑은 AppSettings.chat_llm_env 로 일원화 — 부팅(load_env.rb)과 공유.
    # 런타임 저장: 해시에 있는 키는 set, 없는 키는 삭제(설정 해제 반영).
    chat_env = AppSettings.chat_llm_env(llm)
    AppSettings::CHAT_LLM_ENV_KEYS.each do |k|
      chat_env.key?(k) ? ENV[k] = chat_env[k] : ENV.delete(k)
    end

    # "선택 안함"은 대상 프로바이더가 없으므로 인증/base_url 주입을 스킵한다(idea.md 37).
    unless none_selected
      if provider == "openai"
        ENV["OPENAI_API_KEY"] = preset["auth_token"].to_s
        if preset["base_url"].present?
          ENV["OPENAI_BASE_URL"] = preset["base_url"]
        else
          ENV.delete("OPENAI_BASE_URL")
        end
      else
        ENV["ANTHROPIC_AUTH_TOKEN"] = preset["auth_token"].to_s
        if preset["base_url"].present?
          ENV["ANTHROPIC_BASE_URL"] = preset["base_url"]
        else
          ENV.delete("ANTHROPIC_BASE_URL")
        end
      end
    end

    # app settings
    ENV["SUMMARY_INTERVAL_SEC"] = cfg.dig("summary", "interval_sec").to_s if cfg.dig("summary", "interval_sec")
    # NOTE: 회의 언어 ENV(SELECTED_LANGUAGES/LANGUAGE_MODE) 동기화 제거됨.
    #       사용자별 설정(User#effective_language_config)이 권위 소스.
    #       ENV는 User.server_default_language_config의 폴백 기본값으로만 사용.
    if (audio = cfg["audio"])
      %w[silence_threshold speech_threshold silence_duration_ms max_chunk_sec min_chunk_sec preroll_ms overlap_ms file_chunk_sec].each do |k|
        ENV["AUDIO_#{k.upcase}"] = audio[k].to_s if audio[k]
      end
    end

    # 같은 프로세스(컨트롤러)가 직접 동기화했으므로 기준값을 갱신해 잡의 중복 동기화를 피한다.
    mark_env_synced!
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
