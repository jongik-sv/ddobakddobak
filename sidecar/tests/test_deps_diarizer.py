"""ensure_diarizer_pipeline의 wait 동작 테스트 (배치 경로 로드 대기)."""
import asyncio
from types import SimpleNamespace

import app.deps as deps
from app.deps import ensure_diarizer_pipeline


def _make_app(loading: bool = True):
    """app.state만 흉내내는 최소 객체 (pipeline 없음, 로드 중 여부 설정)."""
    return SimpleNamespace(state=SimpleNamespace(
        diarizer_pipeline=None,
        diarizer_loading=loading,
    ))


async def test_wait_false_returns_none_while_loading():
    """기본(wait=False): 다른 요청이 로드 중이면 즉시 None (실시간 경로 논블로킹)."""
    app = _make_app(loading=True)
    assert await ensure_diarizer_pipeline(app) is None


async def test_wait_true_returns_pipeline_after_concurrent_load(monkeypatch):
    """wait=True: 동시 로드가 끝나면 그 결과 pipeline을 반환한다."""
    monkeypatch.setattr(deps, "_DIARIZER_WAIT_POLL_SEC", 0.01)
    app = _make_app(loading=True)
    sentinel = object()

    async def finish_load():
        await asyncio.sleep(0.05)
        app.state.diarizer_pipeline = sentinel
        app.state.diarizer_loading = False

    task = asyncio.create_task(finish_load())
    result = await ensure_diarizer_pipeline(app, wait=True)
    await task
    assert result is sentinel


async def test_wait_true_returns_none_when_concurrent_load_fails(monkeypatch):
    """wait=True: 동시 로드가 실패(플래그만 해제)하면 None을 반환한다."""
    monkeypatch.setattr(deps, "_DIARIZER_WAIT_POLL_SEC", 0.01)
    app = _make_app(loading=True)

    async def fail_load():
        await asyncio.sleep(0.05)
        app.state.diarizer_loading = False  # pipeline은 None 그대로

    task = asyncio.create_task(fail_load())
    result = await ensure_diarizer_pipeline(app, wait=True)
    await task
    assert result is None
