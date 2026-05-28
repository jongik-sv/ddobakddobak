"""STT 엔진 가용성 탐지.

설치된 패키지와 다운로드된 모델 캐시를 기준으로 사용 가능한 STT 엔진 목록을
산출한다. `AVAILABLE_STT_ENGINES`는 모듈 import 시점에 1회 계산된다.
"""


def _is_model_cached(model_id: str) -> bool:
    """HuggingFace 캐시 디렉터리에 모델 스냅샷이 존재하는지 직접 확인한다.

    scan_cache_dir() 대신 경로 직접 검사를 사용해 속도와 신뢰성을 높인다.
    HF_HUB_CACHE / HF_HOME 환경 변수를 자동으로 반영한다.
    """
    try:
        from pathlib import Path
        from huggingface_hub.constants import HF_HUB_CACHE
        # HF 캐시 폴더명 규칙: models--{org}--{model_name}
        model_dir = Path(HF_HUB_CACHE) / ("models--" + model_id.replace("/", "--"))
        snapshots = model_dir / "snapshots"
        return snapshots.exists() and any(snapshots.iterdir())
    except Exception:
        return False


def _has_module(name: str) -> bool:
    """패키지가 import 가능한지 (실행하지 않고) 확인한다."""
    import importlib.util
    return importlib.util.find_spec(name) is not None


def _detect_available_engines() -> list[str]:
    """설치된 패키지 및 다운로드된 모델 기준으로 사용 가능한 STT 엔진 목록을 반환한다."""
    available = []
    if _has_module("pywhispercpp"):
        available.append("whisper_cpp")
    try:
        import mlx_audio  # noqa: F401
        # Qwen3-ASR 1.7B 양자화 모델 — 캐시에 있는 것만 표시
        from app.stt.factory import _QWEN3_MODEL_IDS
        for engine_id, model_id in _QWEN3_MODEL_IDS.items():
            if _is_model_cached(model_id):
                available.append(engine_id)
    except ImportError:
        pass
    # faster-whisper (CUDA GPU 또는 CPU 폴백)
    if _has_module("faster_whisper"):
        available.append("faster_whisper")
        available.append("faster_whisper_cpu")
    # Qwen3-ASR (qwen-asr 패키지 + NVIDIA CUDA GPU 필수)
    try:
        import torch  # noqa: F401
        import qwen_asr  # noqa: F401
        if torch.cuda.is_available():
            available.append("qwen3_asr_transformers")
            # bitsandbytes 양자화 지원 확인
            try:
                import bitsandbytes  # noqa: F401
                available.append("qwen3_asr_8bit")
                available.append("qwen3_asr_6bit")
            except ImportError:
                pass
    except ImportError:
        pass
    return available


AVAILABLE_STT_ENGINES = _detect_available_engines()
