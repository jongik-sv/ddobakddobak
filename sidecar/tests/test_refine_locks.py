"""POST /refine-notes 회의별 락의 직렬화 + 누수 차단(refine_locks 정리) 검증.

app.main(STT 모델 로드)을 건드리지 않도록 refine_notes 핸들러를 직접 호출한다.
"""
import asyncio
import types

from app.routers.llm import refine_notes
from app.schemas import RefineNotesRequest


class _FakeSummarizer:
    def __init__(self):
        self.active = 0
        self.max_active = 0

    async def refine_notes(self, **kwargs):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        await asyncio.sleep(0.02)  # 겹침 관찰 창
        self.active -= 1
        return "notes"


def _fake_request():
    summarizer = _FakeSummarizer()
    state = types.SimpleNamespace(refine_locks={}, summarizer=summarizer)
    app = types.SimpleNamespace(state=state)
    return types.SimpleNamespace(app=app), summarizer


async def test_same_meeting_requests_serialize_and_lock_is_cleaned():
    http_request, summarizer = _fake_request()
    req = RefineNotesRequest(transcripts=[], meeting_title="M1")

    await asyncio.gather(
        refine_notes(req, http_request),
        refine_notes(req, http_request),
    )

    # 같은 회의 동시 요청은 순차 처리 → 동시 실행 최대 1
    assert summarizer.max_active == 1
    # 끝나면 dict에서 제거 (무한 누적 누수 차단)
    assert http_request.app.state.refine_locks == {}


async def test_distinct_meetings_run_in_parallel_and_are_cleaned():
    http_request, summarizer = _fake_request()
    r1 = RefineNotesRequest(transcripts=[], meeting_title="A")
    r2 = RefineNotesRequest(transcripts=[], meeting_title="B")

    await asyncio.gather(
        refine_notes(r1, http_request),
        refine_notes(r2, http_request),
    )

    # 다른 회의는 병렬 허용 → 동시 실행 2
    assert summarizer.max_active == 2
    assert http_request.app.state.refine_locks == {}


async def test_lock_cleaned_even_on_error():
    http_request, summarizer = _fake_request()

    async def boom(**kwargs):
        raise RuntimeError("llm down")

    summarizer.refine_notes = boom
    req = RefineNotesRequest(transcripts=[], meeting_title="M1")

    try:
        await refine_notes(req, http_request)
    except RuntimeError:
        pass

    # 예외 경로에서도 finally가 정리 → 누수 없음
    assert http_request.app.state.refine_locks == {}
