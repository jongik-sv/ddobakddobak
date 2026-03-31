"""환경 변수 + settings.yaml 설정 (pydantic-settings)."""
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict


def _load_settings_yaml() -> dict:
    """settings.yaml에서 활성 LLM 프리셋 설정을 환경변수 형태로 반환."""
    for candidate in [
        Path(__file__).resolve().parent.parent.parent / "settings.yaml",  # 프로젝트 루트
        Path("settings.yaml"),
    ]:
        if candidate.is_file():
            try:
                cfg = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError:
                continue

            env = {}

            # STT
            if stt_engine := (cfg.get("stt") or {}).get("engine"):
                env["STT_ENGINE"] = str(stt_engine)

            # HF
            if hf_token := (cfg.get("hf") or {}).get("token"):
                env["HF_TOKEN"] = str(hf_token)

            # LLM — 활성 프리셋에서 로드
            llm = cfg.get("llm") or {}
            active_id = llm.get("active_preset")
            presets = llm.get("presets") or {}
            preset = presets.get(active_id) or {}
            provider = preset.get("provider", "anthropic")

            env["LLM_PROVIDER"] = provider
            if preset.get("model"):
                env["LLM_MODEL"] = str(preset["model"])
            if preset.get("max_input_tokens"):
                env["LLM_MAX_INPUT_TOKENS"] = str(preset["max_input_tokens"])
            if preset.get("max_output_tokens"):
                env["LLM_MAX_OUTPUT_TOKENS"] = str(preset["max_output_tokens"])

            if provider == "openai":
                if preset.get("auth_token"):
                    env["OPENAI_API_KEY"] = str(preset["auth_token"])
                if preset.get("base_url"):
                    env["OPENAI_BASE_URL"] = str(preset["base_url"])
            else:
                if preset.get("auth_token"):
                    env["ANTHROPIC_AUTH_TOKEN"] = str(preset["auth_token"])
                if preset.get("base_url"):
                    env["ANTHROPIC_BASE_URL"] = str(preset["base_url"])

            return env

    return {}


# settings.yaml 값을 os.environ에 사전 주입 (pydantic 로드 전)
import os as _os

_yaml_env = _load_settings_yaml()
for _k, _v in _yaml_env.items():
    _os.environ.setdefault(_k, _v)


class Settings(BaseSettings):
    """애플리케이션 설정.

    settings.yaml → 환경 변수 → .env 파일 순으로 로드된다.
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
    LLM_PROVIDER: str = "anthropic"
    ANTHROPIC_AUTH_TOKEN: str = "dummy"
    ANTHROPIC_BASE_URL: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = ""
    LLM_MODEL: str = "glm-4-flash"
    LLM_MAX_INPUT_TOKENS: int = 200000
    LLM_MAX_OUTPUT_TOKENS: int = 10000

    # [재시작 필요] CLI 바이너리 경로 (claude_cli / gemini_cli / codex_cli 프로바이더용)
    CLAUDE_CLI_PATH: str = "claude"
    GEMINI_CLI_PATH: str = "gemini"
    CODEX_CLI_PATH: str = "codex"

    # [재시작 필요] 서버 설정
    HOST: str = "0.0.0.0"
    PORT: int = 13324

    # [재시작 필요] 외부 경로 (Tauri 앱에서 환경변수로 설정)
    MODELS_DIR: str = ""
    SPEAKER_DBS_DIR: str = ""


settings = Settings()

CLI_LLM_PROVIDERS = frozenset({"claude_cli", "gemini_cli", "codex_cli"})
