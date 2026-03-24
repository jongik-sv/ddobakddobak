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

    # STT 엔진 선택 (mock | qwen3_asr_4bit | qwen3_asr_6bit | qwen3_asr_8bit | whisper_cpp | faster_whisper | sensevoice)
    STT_ENGINE: str = "qwen3_asr_8bit"

    # Hugging Face 토큰 (pyannote.audio 화자 분리 모델 접근용)
    HF_TOKEN: str = ""

    # LLM 설정 (ZAI GLM / Ollama)
    ANTHROPIC_AUTH_TOKEN: str = "dummy"
    ANTHROPIC_BASE_URL: str = ""
    LLM_MODEL: str = "glm-4-flash"

    # 서버 설정
    HOST: str = "0.0.0.0"
    PORT: int = 8000


settings = Settings()
