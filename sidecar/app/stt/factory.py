"""STT Factory: STT_ENGINE 환경 변수에 따라 Adapter 인스턴스를 생성한다."""
from __future__ import annotations

import logging
import platform
import sys

from app.stt.base import SttAdapter

logger = logging.getLogger(__name__)

_KNOWN_ENGINES: frozenset[str] = frozenset(
    {"qwen3_asr_4bit", "qwen3_asr_6bit", "qwen3_asr_8bit",
     "qwen3_asr_transformers",
     "mlx_whisper_turbo_8bit", "mlx_whisper_turbo_f16",
     "whisper_cpp", "faster_whisper", "faster_whisper_cpu",
     "mock", "auto"}
)

# Qwen3-ASR 양자화별 모델 ID 매핑
_QWEN3_MODEL_IDS: dict[str, str] = {
    "qwen3_asr_4bit": "mlx-community/Qwen3-ASR-1.7B-4bit",
    "qwen3_asr_6bit": "mlx-community/Qwen3-ASR-1.7B-6bit",
    "qwen3_asr_8bit": "mlx-community/Qwen3-ASR-1.7B-8bit",
}

# MLX Whisper(large-v3-turbo) 양자화별 모델 ID 매핑 (배치 전사 가속용)
_MLX_WHISPER_MODEL_IDS: dict[str, str] = {
    "mlx_whisper_turbo_8bit": "mlx-community/whisper-large-v3-turbo-8bit",
    "mlx_whisper_turbo_f16": "mlx-community/whisper-large-v3-turbo-fp16",
}


def auto_select_engine() -> str:
    """OS/GPU 환경을 감지하여 최적 STT 엔진을 자동 선택한다.

    - macOS Apple Silicon → qwen3_asr_8bit (mlx-audio, Metal GPU)
    - macOS Intel → whisper_cpp (CPU)
    - NVIDIA GPU (CUDA) → qwen3_asr_transformers (CJK 정확도 우수)
    - 그 외 (Windows/Linux 내장 GPU) → whisper_cpp (CPU 폴백)
    """
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "qwen3_asr_8bit"
    try:
        import torch
        if torch.cuda.is_available():
            # Windows/Linux + CUDA: Qwen3-ASR이 CJK(한중일) 언어에서
            # faster_whisper보다 정확도가 높으므로 우선 선택
            return "qwen3_asr_transformers"
    except ImportError:
        pass
    return "whisper_cpp"


def resolve_file_engine(engine: str | None = None) -> str:
    """배치(파일 재전사) STT 엔진을 결정한다.

    settings.STT_FILE_ENGINE 값을 받아 'auto'면 플랫폼별 기본 엔진으로 해석한다.
    - Apple Silicon → mlx_whisper_turbo_8bit (Metal 가속)
    - 그 외        → whisper_cpp (ggml/gguf large-v3-turbo)
    """
    if engine is None:
        from app.config import settings
        engine = settings.STT_FILE_ENGINE

    if engine == "auto":
        if sys.platform == "darwin" and platform.machine() == "arm64":
            resolved = "mlx_whisper_turbo_8bit"
        else:
            resolved = "whisper_cpp"
        logger.info(f"[STT] 배치 엔진 자동 선택: {resolved} (platform={sys.platform}, arch={platform.machine()})")
        return resolved
    return engine


def create_stt_adapter(engine: str | None = None) -> SttAdapter:
    """STT 엔진 이름으로 적절한 Adapter 인스턴스를 반환한다."""
    if engine is None:
        from app.config import settings
        engine = settings.STT_ENGINE

    # auto: 플랫폼 자동 감지
    if engine == "auto":
        engine = auto_select_engine()
        logger.info(f"[STT] 자동 감지 엔진: {engine} (platform={sys.platform}, arch={platform.machine()})")

    if engine == "mock":
        from app.stt.mock_adapter import MockAdapter
        return MockAdapter()

    if engine in _QWEN3_MODEL_IDS:
        from app.stt.qwen3_adapter import Qwen3Adapter
        return Qwen3Adapter(model_id=_QWEN3_MODEL_IDS[engine])

    if engine in _MLX_WHISPER_MODEL_IDS:
        from app.stt.mlx_whisper_adapter import MLXWhisperAdapter
        return MLXWhisperAdapter(model_id=_MLX_WHISPER_MODEL_IDS[engine])

    if engine == "qwen3_asr_transformers":
        from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
        return Qwen3TransformersAdapter()

    if engine == "whisper_cpp":
        from app.stt.whisper_adapter import WhisperAdapter
        return WhisperAdapter()

    if engine == "faster_whisper":
        from app.stt.faster_whisper_adapter import FasterWhisperAdapter
        return FasterWhisperAdapter()

    if engine == "faster_whisper_cpu":
        from app.stt.faster_whisper_adapter import FasterWhisperAdapter
        return FasterWhisperAdapter(device="cpu")

    if engine in _KNOWN_ENGINES:
        raise NotImplementedError(
            f"STT engine '{engine}' is registered but not yet implemented. "
            "Use 'mock' for development."
        )

    raise ValueError(
        f"Unknown STT engine: '{engine}'. "
        f"Available engines: {', '.join(sorted(_KNOWN_ENGINES))}"
    )
