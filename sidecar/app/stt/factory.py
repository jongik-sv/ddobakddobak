"""STT Factory: STT_ENGINE 환경 변수에 따라 Adapter 인스턴스를 생성한다."""
from __future__ import annotations

from app.stt.base import SttAdapter

_KNOWN_ENGINES: frozenset[str] = frozenset(
    {"qwen3_asr_4bit", "qwen3_asr_6bit", "qwen3_asr_8bit",
     "whisper_cpp", "faster_whisper", "sensevoice", "mock"}
)

# Qwen3-ASR 양자화별 모델 ID 매핑
_QWEN3_MODEL_IDS: dict[str, str] = {
    "qwen3_asr_4bit": "mlx-community/Qwen3-ASR-1.7B-4bit",
    "qwen3_asr_6bit": "mlx-community/Qwen3-ASR-1.7B-6bit",
    "qwen3_asr_8bit": "mlx-community/Qwen3-ASR-1.7B-8bit",
}


def create_stt_adapter(engine: str | None = None) -> SttAdapter:
    """STT 엔진 이름으로 적절한 Adapter 인스턴스를 반환한다."""
    if engine is None:
        from app.config import settings
        engine = settings.STT_ENGINE

    if engine == "mock":
        from app.stt.mock_adapter import MockAdapter
        return MockAdapter()

    if engine in _QWEN3_MODEL_IDS:
        from app.stt.qwen3_adapter import Qwen3Adapter
        return Qwen3Adapter(model_id=_QWEN3_MODEL_IDS[engine])

    if engine == "whisper_cpp":
        from app.stt.whisper_adapter import WhisperAdapter
        return WhisperAdapter()

    if engine in _KNOWN_ENGINES:
        raise NotImplementedError(
            f"STT engine '{engine}' is registered but not yet implemented. "
            "Use 'mock' for development."
        )

    raise ValueError(
        f"Unknown STT engine: '{engine}'. "
        f"Available engines: {', '.join(sorted(_KNOWN_ENGINES))}"
    )
