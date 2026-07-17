"""레버③ per-chunk FIFO gpu_lock 검증 (TSK: 실시간·배치 STT GPU 경쟁 완화).

배치(_chunked_transcribe)가 청크마다 gpu_lock을 잡았다 놓아, 대기 중인 실시간
(/transcribe, /ws/transcribe) 요청이 asyncio.Lock의 FIFO 특성상 배치의 다음
청크보다 먼저 락을 획득하는지를 mock adapter로 검증한다. 실제 STT 모델은
전혀 로드하지 않는다(GPU 부하 없음) — adapter는 전부 asyncio.sleep으로
"GPU 추론 중"을 흉내내는 fake 객체다.
"""
import asyncio
import time

from fastapi import WebSocketDisconnect

from app.routers.stt import _chunked_transcribe, ws_transcribe
from app.stt.base import TranscriptSegment


class _SlowFakeAdapter:
    """청크마다 sleep_sec만큼 'GPU 추론'을 흉내내고, 시작/종료를 events에 기록한다."""

    def __init__(self, events: list, sleep_sec: float = 0.05):
        self._events = events
        self._sleep_sec = sleep_sec
        self.call_count = 0

    async def transcribe(self, chunk, languages=None, mode="single"):
        idx = self.call_count
        self.call_count += 1
        tag = f"chunk_{idx}"
        self._events.append(f"{tag}_start")
        await asyncio.sleep(self._sleep_sec)
        self._events.append(f"{tag}_end")
        return [
            TranscriptSegment(
                text="x", started_at_ms=0, ended_at_ms=100,
                language="ko", confidence=1.0, speaker_label="",
            )
        ]


async def _fake_realtime_request(lock: asyncio.Lock, events: list, delay_before: float, hold_sec: float) -> None:
    """/transcribe 실시간 요청을 흉내낸다 — delay_before 후 gpu_lock 획득을 시도한다."""
    await asyncio.sleep(delay_before)
    async with lock:
        events.append("realtime_start")
        await asyncio.sleep(hold_sec)
        events.append("realtime_end")


# ── (a)+(b) 배치 청크 사이 인터리빙 + FIFO 우선순위 ──────────────────────────
async def test_chunked_transcribe_interleaves_with_realtime_between_chunks():
    """청크0 완료 직후 대기 중이던 실시간 요청이 청크1보다 먼저 락을 획득한다(FIFO)."""
    events: list[str] = []
    lock = asyncio.Lock()
    adapter = _SlowFakeAdapter(events, sleep_sec=0.05)

    # 3초치 PCM(16kHz mono int16), chunk_sec=1 → 청크 3개
    audio = b"\x00\x01" * 16000 * 3

    batch_task = asyncio.create_task(
        _chunked_transcribe(
            adapter, audio, chunk_sec=1, overlap_sec=0,
            meeting_id=None, gpu_lock=lock,
        )
    )
    # chunk_0이 락을 쥔 상태(0.05초)에서 실시간 요청이 대기열에 합류하도록
    # 첫 청크 시작 직후(0.01초)에 획득을 시도하게 한다.
    realtime_task = asyncio.create_task(
        _fake_realtime_request(lock, events, delay_before=0.01, hold_sec=0.01)
    )

    segments = await batch_task
    await realtime_task

    assert len(segments) == 3  # 인터리빙에도 배치는 정상 완료 (starvation 없음)
    assert events == [
        "chunk_0_start", "chunk_0_end",
        "realtime_start", "realtime_end",
        "chunk_1_start", "chunk_1_end",
        "chunk_2_start", "chunk_2_end",
    ]


# ── (b) 락 보유 중 실시간 태스크는 실제로 대기한다 ────────────────────────────
async def test_chunked_transcribe_realtime_waits_while_chunk_holds_lock():
    """청크가 락을 쥔 동안에는 실시간 요청이 critical section에 진입하지 못한다."""
    events: list[tuple] = []
    lock = asyncio.Lock()

    class _TimedAdapter:
        async def transcribe(self, chunk, languages=None, mode="single"):
            events.append(("chunk_start", time.monotonic()))
            await asyncio.sleep(0.05)
            events.append(("chunk_end", time.monotonic()))
            return []

    audio = b"\x00\x01" * 16000 * 1  # 1초치 → 청크 1개

    async def realtime():
        await asyncio.sleep(0.01)  # 청크가 락을 잡은 후 대기열에 합류
        t_wait_start = time.monotonic()
        async with lock:
            events.append(("realtime_acquired", time.monotonic()))
        return t_wait_start

    batch_task = asyncio.create_task(
        _chunked_transcribe(_TimedAdapter(), audio, chunk_sec=1, overlap_sec=0, gpu_lock=lock)
    )
    realtime_task = asyncio.create_task(realtime())

    await batch_task
    t_wait_start = await realtime_task

    times = {tag: t for tag, t in events}
    tags = [tag for tag, _ in events]
    assert tags.index("chunk_end") < tags.index("realtime_acquired")
    assert t_wait_start < times["chunk_end"]  # 대기가 청크 완료 전에 시작됐다는 증거
    assert times["realtime_acquired"] >= times["chunk_end"]  # 청크 완료 후에야 획득


# ── (c) 비분할 경로(file_chunk_sec<=0)는 락을 잡지 않는다 ────────────────────
def test_unsplit_path_does_not_reference_gpu_lock():
    """transcribe_file의 비분할(else) 분기 소스에 gpu_lock 참조가 없어야 한다.

    이 경로는 Rails가 쓰지 않는 직접 호출 전용이며, 파일 전체 추론 동안
    gpu_lock을 쥐면 실시간이 그만큼 굶는 역효과가 나므로 의도적으로 무락 유지.
    """
    import inspect
    from app.routers import stt as stt_router

    src = inspect.getsource(stt_router.transcribe_file)
    else_block = src.split("        else:\n", 1)[1].split("    finally:")[0]
    # 주석에는 "gpu_lock"이라는 단어 자체가 (안 잡는 이유 설명으로) 등장할 수 있으므로
    # 실제로 락을 거는 코드 패턴("async with ... gpu_lock")만 부재를 검증한다.
    assert "async with" not in else_block
    assert "file_adapter.transcribe(" in else_block


# ── 하위호환: gpu_lock 미전달 시에도 정상 동작 ────────────────────────────────
async def test_chunked_transcribe_without_gpu_lock_still_works():
    """gpu_lock 미전달(기존 호출부) 시 매 청크마다 새 락을 써서 그대로 동작한다."""
    events: list[str] = []
    adapter = _SlowFakeAdapter(events, sleep_sec=0.0)
    audio = b"\x00\x01" * 16000 * 2
    segments = await _chunked_transcribe(adapter, audio, chunk_sec=1, overlap_sec=0)
    assert len(segments) == 2


# ── (d) /ws/transcribe 경로도 gpu_lock을 잡는다 ──────────────────────────────
class _FakeWSState:
    def __init__(self, adapter, gpu_lock):
        self.stt_adapter = adapter
        self.gpu_lock = gpu_lock


class _FakeWSApp:
    def __init__(self, adapter, gpu_lock):
        self.state = _FakeWSState(adapter, gpu_lock)


class _FakeWebSocket:
    """ws_transcribe가 쓰는 최소 인터페이스만 흉내내는 duck-typed fake."""

    def __init__(self, app, chunks):
        self.app = app
        self._chunks = list(chunks)
        self.sent: list[dict] = []

    async def accept(self):
        pass

    async def receive_bytes(self):
        if not self._chunks:
            raise WebSocketDisconnect()
        return self._chunks.pop(0)

    async def send_json(self, data):
        self.sent.append(data)


async def test_ws_transcribe_holds_gpu_lock_during_inference():
    """ws_transcribe가 adapter.transcribe 호출 동안 gpu_lock을 보유하는지 검증."""
    lock = asyncio.Lock()
    observed: list[bool] = []

    class _LockCheckingAdapter:
        async def transcribe(self, audio_bytes, languages=None, mode="single"):
            observed.append(lock.locked())
            return []

    fake_app = _FakeWSApp(_LockCheckingAdapter(), lock)
    ws = _FakeWebSocket(fake_app, [b"\x00" * 3200])

    await ws_transcribe(ws)

    assert observed == [True]
    assert not lock.locked()  # 호출 종료 후 정상 해제
