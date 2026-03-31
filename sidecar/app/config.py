"""환경 변수 설정 (pydantic-settings)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """애플리케이션 설정.

    환경 변수 또는 .env 파일에서 자동으로 로드된다.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # [재시작 필요] STT 엔진 선택 (mock | qwen3_asr_4bit | qwen3_asr_6bit | qwen3_asr_8bit | whisper_cpp | faster_whisper | sensevoice | auto)
    STT_ENGINE: str = "auto"

    # [재시작 필요] Hugging Face 토큰 (pyannote.audio 화자 분리 모델 접근용)
    HF_TOKEN: str = ""

    # LLM 설정 — 아래 항목 변경 시 모두 [재시작 필요]
    # LLM_PROVIDER: "anthropic" (기본), "openai" (OpenAI 호환 API: Ollama, vLLM 등),
    #               "claude_cli", "gemini_cli", "codex_cli" (CLI 파이프 모드)
    LLM_PROVIDER: str = "anthropic"       # [재시작 필요] LLM 백엔드 선택
    ANTHROPIC_AUTH_TOKEN: str = "dummy"   # [재시작 필요] Anthropic API 토큰
    ANTHROPIC_BASE_URL: str = ""          # [재시작 필요] Anthropic API 커스텀 URL
    OPENAI_API_KEY: str = ""              # [재시작 필요] OpenAI 호환 API 키
    OPENAI_BASE_URL: str = ""             # [재시작 필요] OpenAI 호환 API URL
    LLM_MODEL: str = "glm-4-flash"       # [재시작 필요] 사용할 모델명
    LLM_MAX_INPUT_TOKENS: int = 200000   # [재시작 필요] 최대 입력 토큰
    LLM_MAX_OUTPUT_TOKENS: int = 10000   # [재시작 필요] 최대 출력 토큰

    # [재시작 필요] CLI 바이너리 경로 (claude_cli / gemini_cli / codex_cli 프로바이더용)
    CLAUDE_CLI_PATH: str = "claude"
    GEMINI_CLI_PATH: str = "gemini"
    CODEX_CLI_PATH: str = "codex"

    # [재시작 필요] 서버 설정
    HOST: str = "0.0.0.0"
    PORT: int = 13324

    # [재시작 필요] 외부 경로 (Tauri 앱에서 환경변수로 설정)
    MODELS_DIR: str = ""           # ML 모델 저장 디렉토리 (빈 문자열이면 기본 캐시 사용)
    SPEAKER_DBS_DIR: str = ""      # 화자 DB 디렉토리 (빈 문자열이면 sidecar/speaker_dbs/)


settings = Settings()

CLI_LLM_PROVIDERS = frozenset({"claude_cli", "gemini_cli", "codex_cli"})
