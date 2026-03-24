"""Tests for WebSocket /ws/transcribe and POST /transcribe (TSK-02-04)."""
import base64

import pytest
from fastapi.testclient import TestClient


# ── fixture: lifespan이 실행된 TestClient ────────────────────────────────────
@pytest.fixture()
def client():
    """lifespan(모델 로드)이 실행된 TestClient를 반환한다."""
    from app.main import app
    with TestClient(app) as c:
        yield c


# ── POST /transcribe ─────────────────────────────────────────────────────────
def test_transcribe_post_returns_200(client):
    audio = b"\x00" * 96000
    audio_b64 = base64.b64encode(audio).decode()
    response = client.post("/transcribe", json={"audio": audio_b64})
    assert response.status_code == 200


def test_transcribe_post_response_has_segments(client):
    audio = b"\x00" * 96000
    audio_b64 = base64.b64encode(audio).decode()
    response = client.post("/transcribe", json={"audio": audio_b64})
    data = response.json()
    assert "segments" in data
    assert isinstance(data["segments"], list)


def test_transcribe_post_segment_has_required_fields(client):
    audio = b"\x00" * 96000
    audio_b64 = base64.b64encode(audio).decode()
    response = client.post("/transcribe", json={"audio": audio_b64})
    segments = response.json()["segments"]
    assert len(segments) > 0
    seg = segments[0]
    assert "text" in seg
    assert "started_at_ms" in seg
    assert "ended_at_ms" in seg
    assert "language" in seg
    assert "confidence" in seg


def test_transcribe_post_invalid_base64_returns_422(client):
    response = client.post("/transcribe", json={"audio": "not-valid-base64!!!"})
    assert response.status_code == 422


def test_transcribe_post_missing_audio_field_returns_422(client):
    response = client.post("/transcribe", json={})
    assert response.status_code == 422


# ── WS /ws/transcribe ────────────────────────────────────────────────────────
def test_ws_transcribe_connects(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        assert ws is not None


def test_ws_transcribe_receives_final_message(client):
    audio = b"\x00" * 96000  # 3초 PCM
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data = ws.receive_json()
        assert data["type"] in ("partial", "final")


def test_ws_transcribe_message_has_required_fields(client):
    audio = b"\x00" * 96000
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data = ws.receive_json()
        assert "type" in data
        assert "text" in data
        assert "started_at_ms" in data
        assert "ended_at_ms" in data
        assert "seq" in data


def test_ws_transcribe_message_type_is_final(client):
    audio = b"\x00" * 96000
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data = ws.receive_json()
        assert data["type"] == "final"


def test_ws_transcribe_seq_increments(client):
    audio = b"\x00" * 96000
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data1 = ws.receive_json()
        ws.send_bytes(audio)
        data2 = ws.receive_json()
        assert data2["seq"] > data1["seq"]


def test_ws_transcribe_speaker_field_present(client):
    audio = b"\x00" * 96000
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data = ws.receive_json()
        assert "speaker" in data


def test_ws_transcribe_text_is_string(client):
    audio = b"\x00" * 96000
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(audio)
        data = ws.receive_json()
        assert isinstance(data["text"], str)
