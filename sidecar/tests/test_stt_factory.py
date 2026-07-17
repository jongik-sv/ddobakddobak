"""Tests for STT Factory pattern."""
import asyncio
import importlib.util
import os
import platform
import sys
import types

import pytest


def test_create_adapter_with_unknown_engine_raises_value_error():
    from app.stt.factory import create_stt_adapter
    with pytest.raises(ValueError, match="Unknown STT engine"):
        create_stt_adapter("nonexistent_engine")


def test_mock_adapter_is_loaded_initially_false():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    assert adapter.is_loaded is False


def test_mock_adapter_load_model_sets_is_loaded_true():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    assert adapter.is_loaded is True


def test_mock_adapter_transcribe_returns_list():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"fake_audio"))
    assert isinstance(result, list)
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_mock_adapter_transcribe_segment_has_text():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"fake_audio"))
    assert isinstance(result[0].text, str)
    assert len(result[0].text) > 0


def test_mock_adapter_transcribe_file_returns_list():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe_file("/fake/path.wav"))
    assert isinstance(result, list)
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_mock_adapter_transcribe_stream_yields_segments():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment

    async def collect_stream():
        adapter = MockAdapter()
        await adapter.load_model()
        segments = []
        async for seg in adapter.transcribe_stream(iter([b"chunk1", b"chunk2"])):
            segments.append(seg)
        return segments

    segments = asyncio.get_event_loop().run_until_complete(collect_stream())
    assert len(segments) > 0
    assert isinstance(segments[0], TranscriptSegment)


def test_transcript_segment_fields():
    from app.stt.base import TranscriptSegment
    seg = TranscriptSegment(
        text="테스트 텍스트",
        started_at_ms=0,
        ended_at_ms=3000,
        language="ko",
        confidence=0.95,
    )
    assert seg.text == "테스트 텍스트"
    assert seg.started_at_ms == 0
    assert seg.ended_at_ms == 3000
    assert seg.language == "ko"
    assert seg.confidence == 0.95


def test_transcript_segment_default_values():
    from app.stt.base import TranscriptSegment
    seg = TranscriptSegment(text="hello", started_at_ms=0, ended_at_ms=1000)
    assert seg.language == "ko"
    assert seg.confidence == 0.0


# ── Qwen3-ASR 양자화 엔진 라우팅 (플랫폼별) ──────────────────────────
# 버그 회귀 방지: CUDA(비-Apple)에서 qwen3_asr_6bit/8bit가 MLX(Apple 전용) 어댑터로
# 라우팅되면 load_model에서 실패한다. 비-Apple에선 transformers 어댑터로 가야 한다.
# 어댑터 __init__은 torch/mlx/qwen_asr를 import하지 않으므로 GPU 없이 인스턴스화 검증 가능.

@pytest.mark.parametrize("engine,expected_quant", [
    ("qwen3_asr_6bit", "6bit"),
    ("qwen3_asr_8bit", "8bit"),
    ("qwen3_asr_4bit", None),  # CUDA엔 4bit bnb 경로 없음 → full precision
])
def test_qwen3_quant_engines_route_to_transformers_on_non_apple(engine, expected_quant, monkeypatch):
    from app.stt import factory
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: False)

    adapter = factory.create_stt_adapter(engine)

    assert isinstance(adapter, Qwen3TransformersAdapter)
    assert adapter._quantization == expected_quant
    # MLX repo id가 CUDA 어댑터로 새어들어가지 않아야 한다.
    assert adapter._model_id == "Qwen/Qwen3-ASR-1.7B"


@pytest.mark.parametrize("engine,expected_model_id", [
    ("qwen3_asr_6bit", "mlx-community/Qwen3-ASR-1.7B-6bit"),
    ("qwen3_asr_8bit", "mlx-community/Qwen3-ASR-1.7B-8bit"),
])
def test_qwen3_quant_engines_route_to_mlx_on_apple_silicon(engine, expected_model_id, monkeypatch):
    from app.stt import factory
    from app.stt.qwen3_adapter import Qwen3Adapter
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: True)

    adapter = factory.create_stt_adapter(engine)

    assert isinstance(adapter, Qwen3Adapter)
    assert adapter._model_id == expected_model_id


def test_qwen3_transformers_adapter_defaults_to_bf16_full_precision():
    """auto 경로가 만드는 기본 어댑터는 양자화 없음(full precision) 이어야 한다."""
    from app.stt import factory
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    adapter = factory.create_stt_adapter("qwen3_asr_transformers")
    assert isinstance(adapter, Qwen3TransformersAdapter)
    assert adapter._quantization is None
    assert adapter._model_id == "Qwen/Qwen3-ASR-1.7B"


# ── qwen3_asr_vllm 라우팅 (vLLM 서빙 백엔드) ─────────────────────────
# 어댑터 __init__은 vllm/torch를 import하지 않으므로 vLLM 미설치 환경에서도 인스턴스화 검증 가능.

def test_qwen3_asr_vllm_engine_routes_to_transformers_adapter_with_vllm_backend():
    from app.stt import factory
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    adapter = factory.create_stt_adapter("qwen3_asr_vllm")
    assert isinstance(adapter, Qwen3TransformersAdapter)
    assert adapter._backend == "vllm"
    assert adapter._quantization is None
    assert adapter._model_id == "Qwen/Qwen3-ASR-1.7B"


# ── auto_select_engine: CUDA + vLLM 가용 여부에 따른 분기 ────────────────

def test_auto_select_engine_apple_silicon_unchanged(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(platform, "machine", lambda: "arm64")

    from app.stt import factory
    assert factory.auto_select_engine() == "qwen3_asr_8bit"


def test_auto_select_engine_cuda_with_vllm_available(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")

    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object() if name == "vllm" else None)

    from app.stt import factory
    assert factory.auto_select_engine() == "qwen3_asr_vllm"


def test_auto_select_engine_cuda_without_vllm(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")

    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)

    from app.stt import factory
    assert factory.auto_select_engine() == "qwen3_asr_transformers"


# ── resolve_file_engine: qwen3_asr_vllm 폴백 (vllm 미설치 환경 보호) ──────
# 영속 설정에 qwen3_asr_vllm이 남아있는데 vllm 패키지가 제거된 환경이면
# transformers 어댑터로 대체해야 배치 전사가 ImportError로 죽지 않는다.

def test_resolve_file_engine_vllm_missing_falls_back_to_transformers(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)

    assert factory.resolve_file_engine("qwen3_asr_vllm") == "qwen3_asr_transformers"


def test_resolve_file_engine_vllm_available_stays_vllm(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object() if name == "vllm" else None)

    assert factory.resolve_file_engine("qwen3_asr_vllm") == "qwen3_asr_vllm"


# ── resolve_file_engine: faster_whisper cuDNN 폴백 (프로세스 abort 방지) ──────
# ctranslate2는 CUDA 추론 시작 시 cuDNN을 dlopen하는데, 실패하면 경고만 찍고
# 프로세스를 통째로 abort시킨다(uvicorn 사망 — 2026-07-17 meeting 78 재현:
# "Could not load library libcudnn_ops_infer.so.8"). 엔진 선택 단계에서
# dlopen 가능 여부를 미리 확인하고 불가면 whisper_cpp로 대체해야 한다.

def test_resolve_file_engine_faster_whisper_cudnn_missing_falls_back_to_whisper_cpp(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: False)

    assert factory.resolve_file_engine("faster_whisper") == "whisper_cpp"


def test_resolve_file_engine_faster_whisper_cudnn_ok_stays(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)

    assert factory.resolve_file_engine("faster_whisper") == "faster_whisper"


def test_resolve_file_engine_faster_whisper_without_cuda_skips_cudnn_check(monkeypatch):
    """CUDA 미가용이면 ctranslate2가 CPU로 돌아 cuDNN 불필요 — 폴백하지 않는다."""
    from app.stt import factory
    monkeypatch.setattr(factory, "_cuda_available", lambda: False)

    def _fail():
        raise AssertionError("CUDA 없으면 cuDNN 검사를 호출하면 안 된다")

    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", _fail)

    assert factory.resolve_file_engine("faster_whisper") == "faster_whisper"


def test_available_file_engines_hides_faster_whisper_when_cudnn_missing(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: False)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: False)

    engines = factory.available_file_engines()
    assert "faster_whisper" not in engines
    assert "whisper_cpp" in engines


def test_available_file_engines_includes_faster_whisper_when_cudnn_ok(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: False)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)

    engines = factory.available_file_engines()
    assert "faster_whisper" in engines


def test_required_cudnn_lib_by_ctranslate2_version(monkeypatch):
    """ct2 4.4까지는 cuDNN 8(libcudnn_ops_infer.so.8), 4.5부터 cuDNN 9(libcudnn_ops.so.9)."""
    from app.stt import factory
    monkeypatch.setattr(factory, "_ctranslate2_version", lambda: (4, 4))
    assert factory._required_cudnn_lib() == "libcudnn_ops_infer.so.8"

    monkeypatch.setattr(factory, "_ctranslate2_version", lambda: (4, 5))
    assert factory._required_cudnn_lib() == "libcudnn_ops.so.9"


# ── faster_whisper_ko: 한국어 파인튜닝 CT2 모델 엔진 ─────────────────────
# seastar105/whisper-medium-komixv2의 CT2 변환본을 로컬 경로에서 로드하는 엔진.
# 모델 경로가 준비되지 않은 환경(변환 진행 중 등)에서도 안전하게 폴백해야 한다.

def test_faster_whisper_ko_registered_in_known_engines():
    from app.stt import factory
    assert "faster_whisper_ko" in factory._KNOWN_ENGINES


def test_faster_whisper_ko_model_path_uses_settings_override(monkeypatch):
    from app.stt import factory
    from app.config import settings
    monkeypatch.setattr(settings, "STT_FASTER_WHISPER_KO_MODEL", "/custom/model/path")
    assert factory._faster_whisper_ko_model_path() == "/custom/model/path"


def test_faster_whisper_ko_model_path_falls_back_to_default(monkeypatch):
    from app.stt import factory
    from app.config import settings
    monkeypatch.setattr(settings, "STT_FASTER_WHISPER_KO_MODEL", "")
    assert factory._faster_whisper_ko_model_path() == factory._FASTER_WHISPER_KO_DEFAULT_MODEL_PATH


def test_create_stt_adapter_faster_whisper_ko_uses_custom_model_size(monkeypatch):
    from app.stt import factory
    from app.stt.faster_whisper_adapter import FasterWhisperAdapter
    monkeypatch.setattr(factory, "_faster_whisper_ko_model_path", lambda: "/fake/komixv2-ct2")

    adapter = factory.create_stt_adapter("faster_whisper_ko")

    assert isinstance(adapter, FasterWhisperAdapter)
    assert adapter._model_size == "/fake/komixv2-ct2"
    assert adapter._device == "auto"


def test_resolve_file_engine_faster_whisper_ko_missing_dir_falls_back_to_faster_whisper(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_faster_whisper_ko_model_path", lambda: "/nonexistent/path")
    monkeypatch.setattr(os.path, "isdir", lambda p: False)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)

    assert factory.resolve_file_engine("faster_whisper_ko") == "faster_whisper"


def test_resolve_file_engine_faster_whisper_ko_present_dir_stays(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_faster_whisper_ko_model_path", lambda: "/existing/path")
    monkeypatch.setattr(os.path, "isdir", lambda p: True)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)

    assert factory.resolve_file_engine("faster_whisper_ko") == "faster_whisper_ko"


def test_resolve_file_engine_faster_whisper_ko_dir_present_but_cudnn_missing_falls_back_to_whisper_cpp(monkeypatch):
    """모델 디렉토리는 있지만 cuDNN dlopen이 안 되면 whisper_cpp로 대체돼야 한다."""
    from app.stt import factory
    monkeypatch.setattr(factory, "_faster_whisper_ko_model_path", lambda: "/existing/path")
    monkeypatch.setattr(os.path, "isdir", lambda p: True)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: False)

    assert factory.resolve_file_engine("faster_whisper_ko") == "whisper_cpp"


def test_available_file_engines_includes_faster_whisper_ko_when_model_dir_exists(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: False)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(os.path, "isdir", lambda p: True)

    engines = factory.available_file_engines()
    assert "faster_whisper" in engines
    assert "faster_whisper_ko" in engines


def test_available_file_engines_excludes_faster_whisper_ko_when_model_dir_missing(monkeypatch):
    from app.stt import factory
    monkeypatch.setattr(factory, "_is_apple_silicon", lambda: False)
    monkeypatch.setattr(factory, "_cuda_available", lambda: True)
    monkeypatch.setattr(factory, "_ctranslate2_cudnn_ok", lambda: True)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(os.path, "isdir", lambda p: False)

    engines = factory.available_file_engines()
    assert "faster_whisper" in engines
    assert "faster_whisper_ko" not in engines
