"""STT Factory: STT_ENGINE 환경 변수에 따라 Adapter 인스턴스를 생성한다."""
from __future__ import annotations

import importlib.util
import logging
import os
import platform
import sys
from pathlib import Path

from app.stt.base import SttAdapter

logger = logging.getLogger(__name__)

_KNOWN_ENGINES: frozenset[str] = frozenset(
    {"qwen3_asr_4bit", "qwen3_asr_6bit", "qwen3_asr_8bit",
     "qwen3_asr_transformers", "qwen3_asr_vllm",
     "mlx_whisper_turbo_8bit", "mlx_whisper_turbo_f16",
     "mlx_whisper_turbo_beam", "mlx_whisper_turbo_beam_8bit",
     "whisper_cpp", "faster_whisper", "faster_whisper_cpu",
     "faster_whisper_ko",
     "mock", "auto"}
)

# 한국어 파인튜닝 faster_whisper 모델(CT2 변환본) 기본 캐시 경로.
# settings.STT_FASTER_WHISPER_KO_MODEL이 비어있으면 이 경로를 사용한다.
_FASTER_WHISPER_KO_DEFAULT_MODEL_PATH = str(
    Path.home() / ".cache" / "ddobak" / "stt-models" / "whisper-medium-komixv2-ct2"
)

# Qwen3-ASR 양자화별 모델 ID 매핑 (mlx-community repo — Apple Silicon 전용)
_QWEN3_MODEL_IDS: dict[str, str] = {
    "qwen3_asr_4bit": "mlx-community/Qwen3-ASR-1.7B-4bit",
    "qwen3_asr_6bit": "mlx-community/Qwen3-ASR-1.7B-6bit",
    "qwen3_asr_8bit": "mlx-community/Qwen3-ASR-1.7B-8bit",
}

# CUDA(비-Apple)에서 위 양자화 엔진명 → transformers 어댑터 bitsandbytes 레벨 매핑.
# MLX repo(_QWEN3_MODEL_IDS)는 Apple 전용이라 CUDA에선 로드 불가하므로, 같은 엔진명을
# bitsandbytes 양자화(Qwen/Qwen3-ASR-1.7B)로 대체한다. 값이 None이면 full precision.
# (참고: 한국어 정확도 최우선 + 충분한 VRAM에선 양자화 대신 qwen3_asr_transformers=full BF16 권장.)
_QWEN3_CUDA_QUANT: dict[str, str | None] = {
    "qwen3_asr_6bit": "6bit",
    "qwen3_asr_8bit": "8bit",
    "qwen3_asr_4bit": None,  # CUDA엔 4bit bnb 경로 미구현 → full precision 폴백
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
    - NVIDIA GPU (CUDA) → vllm 설치 시 qwen3_asr_vllm(고속 서빙), 아니면
      qwen3_asr_transformers (CJK 정확도 우수)
    - 그 외 (Windows/Linux 내장 GPU) → whisper_cpp (CPU 폴백)
    """
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "qwen3_asr_8bit"
    try:
        import torch
        if torch.cuda.is_available():
            # Windows/Linux + CUDA: Qwen3-ASR이 CJK(한중일) 언어에서
            # faster_whisper보다 정확도가 높으므로 우선 선택
            # vllm이 설치돼 있으면(실제 import는 하지 않고 find_spec으로만 확인) 더 빠른 vLLM 서빙 백엔드를 우선한다.
            if importlib.util.find_spec("vllm") is not None:
                return "qwen3_asr_vllm"
            return "qwen3_asr_transformers"
    except ImportError:
        pass
    return "whisper_cpp"


def _faster_whisper_ko_model_path() -> str:
    """faster_whisper_ko 엔진이 로드할 한국어 파인튜닝 CT2 모델 경로.

    settings.STT_FASTER_WHISPER_KO_MODEL이 비어있지 않으면 그 값을,
    아니면 기본 캐시 경로(_FASTER_WHISPER_KO_DEFAULT_MODEL_PATH)를 사용한다.
    """
    from app.config import settings
    return settings.STT_FASTER_WHISPER_KO_MODEL or _FASTER_WHISPER_KO_DEFAULT_MODEL_PATH


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


def _cuda_available() -> bool:
    """NVIDIA CUDA GPU 사용 가능 여부 (torch 미설치 환경은 False)."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def _ctranslate2_version() -> tuple[int, int]:
    """설치된 ctranslate2의 (major, minor). 네이티브 lib 로드 없이 metadata로만 조회."""
    from importlib.metadata import version
    parts = version("ctranslate2").split(".")
    return (int(parts[0]), int(parts[1]))


def _required_cudnn_lib() -> str:
    """ctranslate2 CUDA 추론이 dlopen하는 cuDNN so 이름 (4.4까지 cuDNN 8, 4.5부터 9)."""
    try:
        ver = _ctranslate2_version()
    except Exception:
        ver = (4, 4)
    return "libcudnn_ops.so.9" if ver >= (4, 5) else "libcudnn_ops_infer.so.8"


_CUDNN_OK_CACHE: bool | None = None


def _ctranslate2_cudnn_ok() -> bool:
    """faster_whisper(ctranslate2) CUDA 추론이 요구하는 cuDNN을 dlopen할 수 있는지.

    ctranslate2는 CUDA 추론 시작 시 cuDNN dlopen에 실패하면 경고만 찍고 프로세스를
    통째로 abort시킨다("Could not load library libcudnn_ops_infer.so.8" 후 uvicorn 사망).
    같은 방식(dlopen)으로 미리 검사해 엔진 선택 단계에서 걸러낸다.
    리눅스 외 플랫폼은 so 이름 체계가 달라 검사 생략(True).
    """
    global _CUDNN_OK_CACHE
    if _CUDNN_OK_CACHE is not None:
        return _CUDNN_OK_CACHE
    if sys.platform != "linux":
        _CUDNN_OK_CACHE = True
        return _CUDNN_OK_CACHE
    import ctypes
    try:
        ctypes.CDLL(_required_cudnn_lib())
        _CUDNN_OK_CACHE = True
    except OSError:
        _CUDNN_OK_CACHE = False
    return _CUDNN_OK_CACHE


def available_file_engines() -> list[str]:
    """배치(파일 재전사) STT 셀렉터에 노출할 엔진 목록(플랫폼별).

    - Apple Silicon → whisper_cpp(기본·안정) + mlx_whisper_turbo_beam_8bit(고속)
    - NVIDIA CUDA  → whisper_cpp + (vllm 가용 시 qwen3_asr_vllm) + qwen3_asr_transformers(GPU, CJK 정확) + faster_whisper(GPU)
    - 그 외        → whisper_cpp (MLX는 Apple 전용이므로 노출하지 않음)
    """
    if _is_apple_silicon():
        return ["whisper_cpp", "mlx_whisper_turbo_beam_8bit"]
    if _cuda_available():
        engines = ["whisper_cpp"]
        if importlib.util.find_spec("vllm") is not None:
            engines.append("qwen3_asr_vllm")
        engines.append("qwen3_asr_transformers")
        # cuDNN dlopen 불가 환경에서 faster_whisper를 노출하면 선택 즉시 프로세스가
        # abort되므로 목록에서 숨긴다 (resolve_file_engine 폴백과 동일 기준).
        if _ctranslate2_cudnn_ok():
            engines.append("faster_whisper")
            # 한국어 파인튜닝 모델(CT2 변환본)이 로컬에 준비된 경우에만 노출한다
            # (변환 진행 중 등으로 디렉토리가 없으면 선택해도 로드에 실패하므로 숨김).
            if os.path.isdir(_faster_whisper_ko_model_path()):
                engines.append("faster_whisper_ko")
        return engines
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

    # vllm 폴백: 영속 설정에 qwen3_asr_vllm이 남아있어도 vllm 패키지가 제거된
    # 환경이면 transformers 어댑터로 대체 (ImportError로 배치 전사가 죽는 것 방지).
    if engine == "qwen3_asr_vllm" and importlib.util.find_spec("vllm") is None:
        logger.info(
            f"[STT] 배치 엔진 '{engine}'는 vllm 미설치로 사용 불가 → 'qwen3_asr_transformers'로 자동 대체"
        )
        return "qwen3_asr_transformers"

    # faster_whisper_ko 폴백: 한국어 파인튜닝 모델 디렉토리가 없으면(변환 미완료 등)
    # 표준 faster_whisper로 대체한다. 이어서 아래 cudnn 가드가 적용되도록 cudnn 가드
    # 앞에 배치한다.
    if engine == "faster_whisper_ko" and not os.path.isdir(_faster_whisper_ko_model_path()):
        logger.warning(
            "[STT] 배치 엔진 'faster_whisper_ko' 모델 경로(%s)가 없어 'faster_whisper'로 자동 대체",
            _faster_whisper_ko_model_path(),
        )
        engine = "faster_whisper"

    # faster_whisper 폴백: ctranslate2는 CUDA 추론 시작 시 cuDNN dlopen에 실패하면
    # 프로세스를 통째로 abort시킨다(uvicorn 사망 — 2026-07-17 meeting 78 재현).
    # 선택 단계에서 같은 dlopen 검사로 걸러 whisper_cpp로 대체한다.
    # CUDA 미가용이면 CPU 추론이라 cuDNN 불필요 — 검사하지 않는다.
    if engine in ("faster_whisper", "faster_whisper_ko") and _cuda_available() and not _ctranslate2_cudnn_ok():
        logger.warning(
            "[STT] 배치 엔진 '%s'는 cuDNN(%s) 로드 불가 — 사용 시 프로세스가 "
            "중단되므로 'whisper_cpp'로 자동 대체",
            engine,
            _required_cudnn_lib(),
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
        # Apple Silicon: mlx-audio(Metal) 양자화 어댑터.
        if _is_apple_silicon():
            from app.stt.qwen3_adapter import Qwen3Adapter
            return Qwen3Adapter(model_id=_QWEN3_MODEL_IDS[engine])
        # 그 외(주로 CUDA): MLX는 Apple 전용 → bitsandbytes 양자화 transformers 어댑터로 라우팅.
        # (버그 수정: 이전엔 CUDA에서도 MLX 어댑터로 라우팅돼 load_model 시 실패했음)
        from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
        quant = _QWEN3_CUDA_QUANT.get(engine)
        if quant is None:
            logger.info(
                "[STT] '%s'는 CUDA에서 bitsandbytes 매핑이 없어 full-precision으로 로드합니다.", engine
            )
        return Qwen3TransformersAdapter(quantization=quant)

    if engine in _MLX_WHISPER_MODEL_IDS:
        from app.stt.mlx_whisper_adapter import MLXWhisperAdapter
        return MLXWhisperAdapter(model_id=_MLX_WHISPER_MODEL_IDS[engine])

    if engine in _MLX_BEAM_MODEL_IDS:
        from app.stt.mlx_whisper_beam_adapter import MLXWhisperBeamAdapter
        return MLXWhisperBeamAdapter(model_id=_MLX_BEAM_MODEL_IDS[engine])

    if engine == "qwen3_asr_transformers":
        from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
        return Qwen3TransformersAdapter()

    if engine == "qwen3_asr_vllm":
        from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
        return Qwen3TransformersAdapter(backend="vllm")

    if engine == "whisper_cpp":
        from app.stt.whisper_adapter import WhisperAdapter
        return WhisperAdapter()

    if engine == "faster_whisper":
        from app.stt.faster_whisper_adapter import FasterWhisperAdapter
        return FasterWhisperAdapter()

    if engine == "faster_whisper_cpu":
        from app.stt.faster_whisper_adapter import FasterWhisperAdapter
        return FasterWhisperAdapter(device="cpu")

    if engine == "faster_whisper_ko":
        from app.stt.faster_whisper_adapter import FasterWhisperAdapter
        return FasterWhisperAdapter(model_size=_faster_whisper_ko_model_path())

    if engine in _KNOWN_ENGINES:
        raise NotImplementedError(
            f"STT engine '{engine}' is registered but not yet implemented. "
            "Use 'mock' for development."
        )

    raise ValueError(
        f"Unknown STT engine: '{engine}'. "
        f"Available engines: {', '.join(sorted(_KNOWN_ENGINES))}"
    )
