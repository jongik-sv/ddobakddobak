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
