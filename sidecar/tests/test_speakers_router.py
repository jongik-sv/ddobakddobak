"""/speakers 라우터 — pipeline 없이 SpeakerDB 파일만으로 동작 검증."""
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def speaker_db(tmp_path, monkeypatch):
    # _get_db_dir()는 호출 시점에 app.config.settings.SPEAKER_DBS_DIR를 읽는다
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))
    db_file = tmp_path / "meeting_42.json"
    db_file.write_text(json.dumps({
        "next_num": 3,
        "speakers": {"화자 1": [], "화자 2": []},
        "names": {"화자 1": "김철수"},
    }, ensure_ascii=False))
    return db_file


async def test_get_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    speakers = {s["id"]: s["name"] for s in res.json()["speakers"]}
    assert speakers == {"화자 1": "김철수", "화자 2": "화자 2"}


async def test_rename_speaker_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                               json={"name": "이영희"})
    assert res.status_code == 200
    assert res.json() == {"id": "화자 2", "name": "이영희"}
    data = json.loads(speaker_db.read_text())
    assert data["names"]["화자 2"] == "이영희"


async def test_rename_unknown_speaker_returns_404(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/없는화자", params={"meeting_id": 42},
                               json={"name": "X"})
    assert res.status_code == 404


async def test_reset_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert not speaker_db.exists()


class _FakeDiarizer:
    """라이브 diarizer 동기화 seam 검증용 — 호출 기록만 남긴다."""

    def __init__(self):
        self.reset_called = False
        self.renames: list[tuple[str, str]] = []

    def reset_db(self):
        self.reset_called = True

    def rename_speaker(self, speaker_id, name):
        self.renames.append((speaker_id, name))
        return True


@pytest.fixture
def live_diarizer():
    # ASGITransport는 lifespan을 실행하지 않으므로 직접 만들어 넣는다
    fake = _FakeDiarizer()
    app.state.meeting_diarizers = {42: fake}
    yield fake
    del app.state.meeting_diarizers


async def test_reset_clears_live_diarizer_state(speaker_db, live_diarizer):
    """진행 중인 /transcribe가 이전 참조로 옛 상태를 재저장하지 못하도록
    pop뿐 아니라 라이브 인스턴스의 메모리 상태도 초기화해야 한다."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    assert 42 not in app.state.meeting_diarizers
    assert live_diarizer.reset_called


async def test_rename_syncs_live_diarizer(speaker_db, live_diarizer):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                               json={"name": "이영희"})
    assert res.status_code == 200
    assert live_diarizer.renames == [("화자 2", "이영희")]
