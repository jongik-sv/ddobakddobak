"""Tests for STT Factory pattern."""
import asyncio
import importlib.util
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
