"""파일 전사 진행 레지스트리 + GET /transcribe-file/progress/{meeting_id} 검증."""
import pytest
from fastapi.testclient import TestClient

from app.routers import stt as stt_router
from app.routers.stt import (
    _chunked_transcribe,
    _clear_file_progress,
    _get_file_progress,
    _set_file_progress,
)
from app.stt.base import TranscriptSegment


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_registry():
    yield
    stt_router._FILE_PROGRESS.clear()


def test_set_get_clear():
    _set_file_progress(42, 1000, 5000)
    assert _get_file_progress(42) == {"processed_ms": 1000, "total_ms": 5000, "phase": "stt"}
    _clear_file_progress(42)
    assert _get_file_progress(42) is None


def test_phase_post():
    _set_file_progress(42, 5000, 5000, phase="post")
    assert _get_file_progress(42)["phase"] == "post"


def test_set_with_none_meeting_id_is_noop():
    _set_file_progress(None, 1000, 5000)
    assert stt_router._FILE_PROGRESS == {}


def test_progress_endpoint_empty_when_unregistered(client):
    resp = client.get("/transcribe-file/progress/9999")
    assert resp.status_code == 200
    assert resp.json() == {}


def test_progress_endpoint_returns_entry(client):
    _set_file_progress(7, 2000, 8000)
    resp = client.get("/transcribe-file/progress/7")
    assert resp.status_code == 200
    assert resp.json() == {"processed_ms": 2000, "total_ms": 8000, "phase": "stt"}


class _FakeAdapter:
    async def transcribe(self, chunk, languages=None, mode="single"):
        return [
            TranscriptSegment(
                text="x", started_at_ms=0, ended_at_ms=100,
                language="ko", confidence=1.0, speaker_label="",
            )
        ]


async def test_chunked_transcribe_updates_progress():
    # 3초치 PCM (16kHz mono int16 → 32000 bytes/sec)
    audio = b"\x00\x01" * 16000 * 3
    await _chunked_transcribe(
        _FakeAdapter(), audio, chunk_sec=1, overlap_sec=0, meeting_id=123,
    )
    prog = _get_file_progress(123)
    assert prog is not None
    assert prog["total_ms"] == 3000
    assert prog["processed_ms"] == 3000  # 마지막 청크 끝 == 전체 길이
    assert prog["phase"] == "stt"  # 청크 전사 중 기본 phase


async def test_chunked_transcribe_without_meeting_id_does_not_register():
    audio = b"\x00\x01" * 16000 * 2
    await _chunked_transcribe(
        _FakeAdapter(), audio, chunk_sec=1, overlap_sec=0, meeting_id=None,
    )
    assert stt_router._FILE_PROGRESS == {}
