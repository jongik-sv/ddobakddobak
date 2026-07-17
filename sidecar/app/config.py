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
            if file_engine := (cfg.get("stt") or {}).get("file_engine"):
                env["STT_FILE_ENGINE"] = str(file_engine)
            if (idle_unload := (cfg.get("stt") or {}).get("idle_unload_sec")) is not None:
                env["STT_IDLE_UNLOAD_SEC"] = str(idle_unload)
            if (idle_full_unload := (cfg.get("stt") or {}).get("idle_full_unload_sec")) is not None:
                env["STT_IDLE_FULL_UNLOAD_SEC"] = str(idle_full_unload)

            # 화자분리 엔진
            if diar_engine := (cfg.get("diarization") or {}).get("engine"):
                env["DIARIZATION_ENGINE"] = str(diar_engine)

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


def _load_min_chunk_sec() -> str | None:
    """settings.yaml → config.yaml 순으로 audio.min_chunk_sec를 로드한다."""
    for candidate in [
        Path(__file__).resolve().parent.parent.parent / "settings.yaml",
        Path(__file__).resolve().parent.parent.parent / "config.yaml",
    ]:
        if candidate.is_file():
            try:
                cfg = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                val = (cfg.get("audio") or {}).get("min_chunk_sec")
                if val is not None:
                    return str(float(val))
            except Exception:
                continue
    return None


# settings.yaml 값을 os.environ에 사전 주입 (pydantic 로드 전)
import os as _os

_yaml_env = _load_settings_yaml()
if (_min_chunk := _load_min_chunk_sec()) is not None:
    _yaml_env.setdefault("MIN_CHUNK_SEC", _min_chunk)
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

    # [재시작 필요] 배치(파일 재전사) STT 엔진. auto=whisper_cpp(전 플랫폼 공통 기본).
    # 셀렉터 노출: Apple=whisper_cpp/mlx_whisper_turbo_beam_8bit, 그 외=whisper_cpp.
    # MLX 계열(beam/greedy)은 비-Apple에서 whisper_cpp로 자동 대체된다(resolve_file_engine).
    # (whisper_cpp | mlx_whisper_turbo_beam_8bit | mlx_whisper_turbo_beam | mlx_whisper_turbo_8bit | mlx_whisper_turbo_f16 | faster_whisper | qwen3_asr_8bit | auto)
    STT_FILE_ENGINE: str = "auto"

    # [재시작 필요] Hugging Face 토큰 (STT/모델 다운로드용)
    HF_TOKEN: str = ""

    # [재시작 필요] 화자분리 엔진. auto=speakrs(CoreML 바이너리 있으면), 없으면 비활성
    # (speakrs | auto)
    DIARIZATION_ENGINE: str = "auto"

    # GPU 유휴 오프로드 — 1단계(GPU 비우기) TTL(초). 0=비활성.
    # Qwen3(transformers 백엔드): GPU → CPU(RAM 상주). faster_whisper: 완전 언로드(CTranslate2는 CPU 이동 불가).
    STT_IDLE_UNLOAD_SEC: int = 600
    # GPU 유휴 오프로드 — 2단계(완전 해제) TTL(초). 0=비활성.
    # 1단계로 CPU에 상주 중인 모델(Qwen3)을 대상으로, 마지막 추론 시각 기준 이 시간까지 유휴가
    # 지속되면 모델 객체 자체를 해제한다(다음 사용 시 디스크에서 재로드). idle_unload_sec 이하로
    # 설정되면 무시(경고 로그 후 비활성 취급)된다.
    STT_IDLE_FULL_UNLOAD_SEC: int = 3600

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

    # [재시작 필요] 오디오 최소 청크 길이 (초). 이보다 짧으면 환각 방지로 STT 스킵
    MIN_CHUNK_SEC: float = 1.0

    EMBED_MODEL: str = "nlpai-lab/KURE-v1"
    EMBED_MODEL_VERSION: str = "kure-v1"
    EMBED_DEVICE: str = "auto"  # auto -> cuda if available else cpu


settings = Settings()

CLI_LLM_PROVIDERS = frozenset({"claude_cli", "gemini_cli", "codex_cli"})
