"""main._idle_offload_loop 백그라운드 루프 배선 테스트.

TestClient(app) 전체 lifespan(실제 STT 모델 로드)을 거치지 않고, 루프 함수만
짧은 간격으로 직접 구동해 maybe_offload가 주기 호출되는지, idle_unload_sec=0이면
루프 자체에 진입하지 않고 즉시 반환하는지(비활성) 검증한다.

점검 대상은 매 틱 app.state에서 새로 수집된다(_collect_idle_targets) — 고정 리스트를
lifespan에서 한 번만 만들지 않으므로, STT 엔진이 런타임에 교체돼도(health.update_stt_engine)
다음 틱부터 항상 최신 어댑터가 점검된다.
"""
import asyncio

import pytest


class _FakeState:
    pass


class _FakeApp:
    def __init__(self, stt_adapter=None, embedder=None):
        self.state = _FakeState()
        self.state.stt_adapter = stt_adapter
        self.state.embedder = embedder


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
    fake_app = _FakeApp(stt_adapter=adapter)

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
    fake_app = _FakeApp(stt_adapter=adapter)

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
    fake_app = _FakeApp(stt_adapter=adapter)

    # 비활성이면 while 루프에 진입하지 않으므로 큰 interval을 줘도 즉시 반환되어야 한다.
    await asyncio.wait_for(_idle_offload_loop(fake_app, interval_sec=100), timeout=1.0)
    assert adapter.calls == []


@pytest.mark.asyncio
async def test_loop_survives_empty_managed_list(monkeypatch):
    """엔진 교체 중 등록 대상이 비어도(stt_adapter=None, embedder=None) 틱이 예외 없이 지나간다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    fake_app = _FakeApp()

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
    fake_app = _FakeApp(stt_adapter=adapter)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.07)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert adapter.calls >= 2  # 예외에도 불구하고 다음 주기에 재시도됨


@pytest.mark.asyncio
async def test_loop_checks_every_managed_target(monkeypatch):
    """STT 어댑터와 임베딩 인코더가 모두 점검된다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    stt = _CountingAdapter()
    embedder = _CountingAdapter()
    fake_app = _FakeApp(stt_adapter=stt, embedder=embedder)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.09)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(stt.calls) >= 2
    assert len(embedder.calls) >= 2
    assert embedder.calls[0] == (600, 3600)


@pytest.mark.asyncio
async def test_one_target_failure_does_not_block_others(monkeypatch):
    """한 대상이 터져도 같은 틱의 다른 대상은 점검된다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    class _Exploding:
        async def maybe_offload(self, *_args):
            raise RuntimeError("boom")

    healthy = _CountingAdapter()
    fake_app = _FakeApp(stt_adapter=_Exploding(), embedder=healthy)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.07)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(healthy.calls) >= 2


@pytest.mark.asyncio
async def test_loop_picks_up_stt_adapter_swapped_at_runtime(monkeypatch):
    """[회귀] STT 엔진이 런타임에 교체되면(health.update_stt_engine과 동일하게
    app.state.stt_adapter를 새 객체로 교체) 다음 틱부터 새 어댑터가 점검되고,
    옛 어댑터는 더 이상 점검되지 않는다.

    수정 전에는 idle_managed가 lifespan에서 한 번만 고정돼 교체된 새 어댑터가
    영영 점검되지 않고 GPU를 계속 점유했다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    old_adapter = _CountingAdapter()
    new_adapter = _CountingAdapter()
    fake_app = _FakeApp(stt_adapter=old_adapter)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.05)
    assert old_adapter.calls  # 교체 전: 옛 어댑터가 점검됨
    calls_before_swap = len(old_adapter.calls)

    fake_app.state.stt_adapter = new_adapter  # 엔진 교체 시뮬레이션
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert new_adapter.calls  # 교체 후: 새 어댑터가 점검됨
    assert len(old_adapter.calls) == calls_before_swap  # 옛 어댑터는 더 이상 호출되지 않음


@pytest.mark.asyncio
async def test_loop_skips_none_stt_adapter_but_checks_embedder(monkeypatch):
    """[회귀] 엔진 교체 도중 stt_adapter가 일시적으로 None인 틱에도 예외 없이 지나가고,
    같은 틱의 embedder는 정상 점검된다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    embedder = _CountingAdapter()
    fake_app = _FakeApp(stt_adapter=None, embedder=embedder)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(embedder.calls) >= 2


@pytest.mark.asyncio
async def test_loop_ignores_target_without_maybe_offload(monkeypatch):
    """[회귀] maybe_offload 메서드가 없는 객체가 state에 있어도 크래시하지 않는다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    class _NoOffloadMethod:
        """maybe_offload가 없는, 실수로 state에 잘못 올라간 객체를 가정."""

    embedder = _CountingAdapter()
    fake_app = _FakeApp(stt_adapter=_NoOffloadMethod(), embedder=embedder)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(embedder.calls) >= 2
