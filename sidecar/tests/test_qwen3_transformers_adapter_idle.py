"""Qwen3TransformersAdapter의 GPU 유휴 오프로드 배선 테스트.

실제 CUDA/qwen-asr 모델 로드 없이 MagicMock을 `_model`에 직접 주입하고,
`maybe_offload`/`transcribe`가 IdleOffloadController를 통해 올바른 콜백
(`self._model.model.to(...)`, 완전 언로드+재로드)을 호출하는지 검증한다.
"""
import asyncio
from unittest.mock import MagicMock

import pytest

from app.stt.idle_offload import ResidentState


def _make_adapter_with_mock_model(backend: str = "transformers"):
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter

    adapter = Qwen3TransformersAdapter(backend=backend)
    mock_model = MagicMock()
    seg = MagicMock()
    seg.text = "안녕하세요"
    seg.language = "ko"
    mock_model.transcribe.return_value = [seg]
    adapter._model = mock_model
    adapter._is_loaded = True
    adapter._idle.mark_loaded()
    return adapter


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _pcm():
    return b"\x00" * 96000  # 3초 PCM 16kHz 16bit


# ── 기본 상태 ────────────────────────────────────────────────────────

def test_gpu_resident_true_right_after_load():
    adapter = _make_adapter_with_mock_model()
    assert adapter.gpu_resident is True
    assert adapter.resident_state == "gpu"


def test_vllm_backend_never_offloads():
    """vLLM 백엔드는 콜백 미배선 — 아무리 유휴가 길어도 상태 불변."""
    adapter = _make_adapter_with_mock_model(backend="vllm")
    _run(adapter.maybe_offload(0.0, 0.0))  # 즉시 체크(clock 조작 불필요 — TTL 0 도 항상 no-op 확인용)
    assert adapter.gpu_resident is True

    # 실시간 TTL로도 콜백이 없어 절대 전이하지 않음을 명시적으로 확인
    class _AlwaysExpired:
        def __call__(self):
            return 10_000_000.0

    adapter._idle._clock = _AlwaysExpired()
    _run(adapter.maybe_offload(1, 1))
    assert adapter.resident_state == "gpu"


# ── 1단계: GPU -> CPU ────────────────────────────────────────────────

def test_stage1_offload_moves_model_to_cpu():
    adapter = _make_adapter_with_mock_model()
    # last_used를 과거로 밀어 TTL을 즉시 초과시킨다.
    adapter._idle.last_used -= 1000

    _run(adapter.maybe_offload(600, 3600))

    adapter._model.model.to.assert_called_once_with("cpu")
    assert adapter.resident_state == "cpu"
    assert adapter.gpu_resident is False


def test_reload_from_cpu_moves_model_back_to_cuda_on_next_transcribe():
    adapter = _make_adapter_with_mock_model()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "cpu"

    _run(adapter.transcribe(_pcm(), languages=["ko"], mode="single"))

    adapter._model.model.to.assert_any_call("cuda:0")
    assert adapter.resident_state == "gpu"


# ── 2단계: CPU -> UNLOADED, 재추론 시 풀 재로드 ─────────────────────────

def test_stage2_offload_fully_unloads_after_cpu_stage():
    adapter = _make_adapter_with_mock_model()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "cpu"

    adapter._idle.last_used -= 10_000  # 총 유휴시간 재도달
    _run(adapter.maybe_offload(600, 3600))

    assert adapter.resident_state == "unloaded"
    assert adapter._model is None


def test_reload_full_reconstructs_model_via_load_sync():
    adapter = _make_adapter_with_mock_model()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    adapter._idle.last_used -= 10_000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter._model is None

    sentinel = MagicMock(name="reloaded-model")
    sentinel.transcribe.return_value = []  # _infer_from_pcm이 순회할 수 있도록 빈 리스트로 고정
    adapter._load_sync = MagicMock(return_value=sentinel)

    _run(adapter.transcribe(_pcm(), languages=["ko"], mode="single"))

    adapter._load_sync.assert_called_once()
    assert adapter._model is sentinel
    assert adapter.resident_state == "gpu"


# ── transcribe_file 경로도 동일하게 idle 컨트롤러를 거치는지 ─────────────

def test_transcribe_file_touches_idle_and_reloads_from_cpu(tmp_path):
    adapter = _make_adapter_with_mock_model()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "cpu"

    audio_file = tmp_path / "clip.wav"
    audio_file.write_bytes(b"\x00" * 100)

    _run(adapter.transcribe_file(str(audio_file), languages=["ko"], mode="single"))

    adapter._model.model.to.assert_any_call("cuda:0")
    assert adapter.resident_state == "gpu"
