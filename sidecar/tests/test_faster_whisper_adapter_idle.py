"""FasterWhisperAdapter의 GPU 유휴 오프로드 배선 테스트.

CTranslate2는 PyTorch처럼 .to('cpu')로 오갈 수 없으므로 1단계에서 바로 모델
객체를 완전히 해제(del)하고, 다음 사용 시 기존 lazy 로드 경로(_load_sync)를
재사용해 재로드한다(2단계 개념 없음). device="cpu"(faster_whisper_cpu 엔진)는
애초에 GPU를 쓰지 않으므로 오프로드가 no-op이어야 한다.
"""
import asyncio

import numpy as np
import pytest


class _Seg:
    def __init__(self, text="안녕하세요", start=0.0, end=0.1, avg_logprob=-0.1):
        self.text = text
        self.start = start
        self.end = end
        self.avg_logprob = avg_logprob


class _Info:
    def __init__(self, language="ko"):
        self.language = language


class _FakeModel:
    def transcribe(self, audio, language=None, vad_filter=True):
        return iter([_Seg()]), _Info()


def _pcm():
    return np.zeros(16000, dtype=np.int16).tobytes()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _make_adapter(device: str = "auto"):
    from app.stt.faster_whisper_adapter import FasterWhisperAdapter

    adapter = FasterWhisperAdapter(device=device)
    adapter._model = _FakeModel()
    adapter._is_loaded = True
    adapter._idle.mark_loaded()
    return adapter


# ── 기본 상태 ────────────────────────────────────────────────────────

def test_gpu_resident_true_right_after_load():
    adapter = _make_adapter()
    assert adapter.gpu_resident is True
    assert adapter.resident_state == "gpu"


def test_cpu_device_never_offloads():
    """device='cpu'(faster_whisper_cpu)는 GPU를 쓰지 않으므로 오프로드 대상이 아니다."""
    adapter = _make_adapter(device="cpu")
    adapter._idle.last_used -= 1_000_000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "gpu"
    assert adapter._model is not None


# ── 1단계 = 완전 언로드 (CPU 중간 상태 없음) ─────────────────────────────

def test_stage1_offload_fully_unloads_model():
    adapter = _make_adapter()
    adapter._idle.last_used -= 1000  # TTL 즉시 초과

    _run(adapter.maybe_offload(600, 3600))

    assert adapter._model is None
    assert adapter.resident_state == "unloaded"
    assert adapter.gpu_resident is False


def test_idle_full_unload_sec_has_no_further_effect_after_stage1():
    """이미 완전 언로드된 상태이므로 2단계 TTL이 지나도 추가 동작이 없다."""
    adapter = _make_adapter()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "unloaded"

    adapter._idle.last_used -= 1_000_000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter.resident_state == "unloaded"  # 상태 불변, 예외 없음


def test_reload_reconstructs_model_via_load_sync_on_next_transcribe():
    adapter = _make_adapter()
    adapter._idle.last_used -= 1000
    _run(adapter.maybe_offload(600, 3600))
    assert adapter._model is None

    fresh = _FakeModel()
    adapter._load_sync = lambda: fresh

    _run(adapter.transcribe(_pcm(), languages=["ko"], mode="single"))

    assert adapter._model is fresh
    assert adapter.resident_state == "gpu"


def test_zero_ttl_disables_offload():
    adapter = _make_adapter()
    adapter._idle.last_used -= 1_000_000
    _run(adapter.maybe_offload(0, 3600))
    assert adapter._model is not None
    assert adapter.resident_state == "gpu"


# ── 락 경합: 실제 어댑터를 통해서도 추론 중 오프로드가 대기하는지 ────────

@pytest.mark.asyncio
async def test_offload_waits_for_inflight_transcribe_then_skips():
    """추론이 진행 중인 동안 오프로드는 같은 락(self._idle.lock)에서 대기하고,
    추론 종료 후 last_used가 갱신돼 있으므로 오프로드는 스킵된다."""
    adapter = _make_adapter()
    infer_entered = asyncio.Event()
    release_infer = asyncio.Event()

    class _BlockingModel:
        def transcribe(self, audio, language=None, vad_filter=True):
            return iter([_Seg()]), _Info()

    adapter._model = _BlockingModel()
    adapter._idle.last_used -= 1000  # 오프로드 트리거 조건은 이미 만족된 상태로 시작

    async def _blocking_infer():
        async with adapter._idle:
            infer_entered.set()
            await release_infer.wait()  # 락을 쥔 채로 대기 → 오프로드가 반드시 블록되게 함

    infer_task = asyncio.create_task(_blocking_infer())
    await infer_entered.wait()

    offload_task = asyncio.create_task(adapter.maybe_offload(600, 3600))
    await asyncio.sleep(0.01)
    assert not offload_task.done()  # 락을 못 잡아 대기 중이어야 함

    release_infer.set()
    await infer_task
    await offload_task

    assert adapter._model is not None  # last_used가 방금 갱신돼 TTL 미충족 → 오프로드 스킵
    assert adapter.resident_state == "gpu"
