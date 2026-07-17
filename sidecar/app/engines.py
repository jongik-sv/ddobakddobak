"""STT 엔진 가용성 탐지.

플랫폼과 설치된 패키지를 기준으로 실시간 STT 셀렉터에 노출할 엔진 목록을
산출한다. `AVAILABLE_STT_ENGINES`는 모듈 import 시점에 1회 계산된다.
"""


def _has_module(name: str) -> bool:
    """패키지가 import 가능한지 (실행하지 않고) 확인한다."""
    import importlib.util
    return importlib.util.find_spec(name) is not None


def _detect_available_engines() -> list[str]:
    """플랫폼/설치 패키지 기준으로 실시간 STT 셀렉터에 노출할 엔진 목록을 반환한다.

    - Apple Silicon(mlx-audio) → Qwen3-ASR 6bit/8bit 2개만 (셀렉터 단순화).
      모델이 캐시에 없으면 첫 선택 시 다운로드된다.
    - 그 외 플랫폼            → 설치된 패키지/하드웨어로 폴백 엔진을 자동 노출
      (whisper_cpp / faster_whisper / CUDA Qwen). MLX 엔진은 노출하지 않는다.
    """
    import platform
    import sys

    if sys.platform == "darwin" and platform.machine() == "arm64" and _has_module("mlx_audio"):
        return ["qwen3_asr_8bit", "qwen3_asr_6bit"]

    available = []
    if _has_module("pywhispercpp"):
        available.append("whisper_cpp")
    # faster-whisper (CUDA GPU 또는 CPU 폴백)
    if _has_module("faster_whisper"):
        available.append("faster_whisper")
        available.append("faster_whisper_cpu")
    # Qwen3-ASR (qwen-asr 패키지 + NVIDIA CUDA GPU 필수)
    try:
        import torch  # noqa: F401
        import qwen_asr  # noqa: F401
        if torch.cuda.is_available():
            # vLLM 서빙 백엔드(고속) — 설치돼 있으면 노출 (실제 import는 무거워서 find_spec만 확인)
            # auto_select_engine/available_file_engines와 노출 순서를 맞추기 위해 transformers보다 앞에 배치
            if _has_module("vllm"):
                available.append("qwen3_asr_vllm")
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
