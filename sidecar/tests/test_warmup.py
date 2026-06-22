"""POST /warmup — 예약 회의 1분 전 STT 어댑터 워밍업 엔드포인트 검증."""
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import app


def test_warmup_runs_adapter_once_and_returns_200():
    """2초 무음으로 어댑터를 1회 호출하고 {"warmed": true}를 반환한다."""
    fake = AsyncMock()
    fake.transcribe = AsyncMock(return_value=type("R", (), {"segments": []})())
    app.state.stt_adapter = fake
    client = TestClient(app)
    res = client.post("/warmup")
    assert res.status_code == 200
    assert res.json()["warmed"] is True
    fake.transcribe.assert_awaited()  # 어댑터 추론 1회 호출


def test_warmup_returns_200_even_if_adapter_raises():
    """어댑터 추론 실패 시에도 200과 {"warmed": true}를 반환한다 (best-effort)."""
    fake = AsyncMock()
    fake.transcribe = AsyncMock(side_effect=RuntimeError("adapter exploded"))
    app.state.stt_adapter = fake
    client = TestClient(app)
    res = client.post("/warmup")
    assert res.status_code == 200
    assert res.json()["warmed"] is True
