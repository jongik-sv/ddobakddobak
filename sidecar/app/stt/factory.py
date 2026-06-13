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
     "mlx_whisper_turbo_beam", "mlx_whisper_turbo_beam_8bit",
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

# MLX beam search(vendored Lightning) 엔진별 모델 ID. beam 디코더 + 양자화 선택.
# f16=full repo(정확, 큼), 8bit=양자화(품질 동급, 모델 절반·빠름).
_MLX_BEAM_MODEL_IDS: dict[str, str] = {
    "mlx_whisper_turbo_beam": "mlx-community/whisper-large-v3-turbo",
    "mlx_whisper_turbo_beam_8bit": "mlx-community/whisper-large-v3-turbo-8bit",
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


def _is_apple_silicon() -> bool:
    """현재 호스트가 Apple Silicon(macOS arm64)인지 — MLX/Metal 엔진 가용 기준."""
    return sys.platform == "darwin" and platform.machine() == "arm64"


def _is_mlx_engine(engine: str) -> bool:
    """MLX(mlx-audio/Metal) 기반 엔진인지 — Apple Silicon 전용으로만 동작한다."""
    return (
        engine in _MLX_WHISPER_MODEL_IDS
        or engine in _MLX_BEAM_MODEL_IDS
        or engine in _QWEN3_MODEL_IDS
    )


def available_file_engines() -> list[str]:
    """배치(파일 재전사) STT 셀렉터에 노출할 엔진 목록(플랫폼별).

    - Apple Silicon → whisper_cpp(기본·안정) + mlx_whisper_turbo_beam_8bit(고속)
    - 그 외        → whisper_cpp (MLX는 Apple 전용이므로 노출하지 않음)
    """
    if _is_apple_silicon():
        return ["whisper_cpp", "mlx_whisper_turbo_beam_8bit"]
    return ["whisper_cpp"]


def resolve_file_engine(engine: str | None = None) -> str:
    """배치(파일 재전사) STT 엔진을 결정한다.

    settings.STT_FILE_ENGINE 값을 받아 실제 실행할 엔진으로 해석한다.
    - 'auto'                  → whisper_cpp (전 플랫폼 공통 기본: gguf large-v3-turbo, 안정·환각 없음)
    - 비-Apple에서 MLX 계열 지정 → whisper_cpp로 자동 대체 (MLX는 Apple Silicon 전용)
    """
    if engine is None:
        from app.config import settings
        engine = settings.STT_FILE_ENGINE

    if engine == "auto":
        logger.info(
            f"[STT] 배치 엔진 자동 선택: whisper_cpp (platform={sys.platform}, arch={platform.machine()})"
        )
        return "whisper_cpp"

    # 플랫폼 폴백: MLX 엔진을 비-Apple에서 고르면(또는 yaml로 지정되면) whisper_cpp로 대체.
    if not _is_apple_silicon() and _is_mlx_engine(engine):
        logger.info(
            f"[STT] 배치 엔진 '{engine}'는 Apple Silicon 전용 → 'whisper_cpp'로 자동 대체 "
            f"(platform={sys.platform}, arch={platform.machine()})"
        )
        return "whisper_cpp"

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

    if engine in _MLX_BEAM_MODEL_IDS:
        from app.stt.mlx_whisper_beam_adapter import MLXWhisperBeamAdapter
        return MLXWhisperBeamAdapter(model_id=_MLX_BEAM_MODEL_IDS[engine])

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
