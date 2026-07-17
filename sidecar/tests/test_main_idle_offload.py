"""main._idle_offload_loop 백그라운드 루프 배선 테스트.

TestClient(app) 전체 lifespan(실제 STT 모델 로드)을 거치지 않고, 루프 함수만
짧은 간격으로 직접 구동해 maybe_offload가 주기 호출되는지, idle_unload_sec=0이면
루프 자체에 진입하지 않고 즉시 반환하는지(비활성) 검증한다.
"""
import asyncio

import pytest


class _FakeState:
    pass


class _FakeApp:
    def __init__(self, adapter):
        self.state = _FakeState()
        self.state.stt_adapter = adapter


class _CountingAdapter:
    def __init__(self):
        self.calls: list[tuple[float, float]] = []

    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        self.calls.append((idle_unload_sec, idle_full_unload_sec))


@pytest.mark.asyncio
async def test_loop_calls_maybe_offload_periodically_with_resolved_thresholds(monkeypatch):
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    adapter = _CountingAdapter()
    fake_app = _FakeApp(adapter)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.09)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(adapter.calls) >= 2
    assert adapter.calls[0] == (600, 3600)


@pytest.mark.asyncio
async def test_loop_resolves_invalid_full_unload_before_looping(monkeypatch):
    """idle_full_unload_sec <= idle_unload_sec인 이상 설정이면 루프 시작 전에 보정되어
    매 틱마다 보정된(0) 값으로 maybe_offload가 호출돼야 한다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 100)  # 이상 설정

    adapter = _CountingAdapter()
    fake_app = _FakeApp(adapter)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.03)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert adapter.calls
    assert adapter.calls[0] == (600, 0)


@pytest.mark.asyncio
async def test_loop_exits_immediately_when_disabled(monkeypatch):
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 0)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    adapter = _CountingAdapter()
    fake_app = _FakeApp(adapter)

    # 비활성이면 while 루프에 진입하지 않으므로 큰 interval을 줘도 즉시 반환되어야 한다.
    await asyncio.wait_for(_idle_offload_loop(fake_app, interval_sec=100), timeout=1.0)
    assert adapter.calls == []


@pytest.mark.asyncio
async def test_loop_survives_none_adapter(monkeypatch):
    """엔진 교체 중(app.state.stt_adapter=None) 틱이 와도 예외 없이 스킵한다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    fake_app = _FakeApp(adapter=None)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    # 예외 없이 여기까지 도달하면 성공


@pytest.mark.asyncio
async def test_loop_survives_maybe_offload_exception(monkeypatch):
    """어댑터의 maybe_offload가 예외를 던져도 루프 자체는 계속 돈다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    class _FlakyAdapter:
        def __init__(self):
            self.calls = 0

        async def maybe_offload(self, *_args):
            self.calls += 1
            raise RuntimeError("boom")

    adapter = _FlakyAdapter()
    fake_app = _FakeApp(adapter)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.07)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert adapter.calls >= 2  # 예외에도 불구하고 다음 주기에 재시도됨
