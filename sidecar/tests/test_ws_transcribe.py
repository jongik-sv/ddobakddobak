"""Tests for WebSocket /ws/transcribe and POST /transcribe (TSK-02-04).

이 파일이 검증하는 것은 `POST /transcribe`·`/ws/transcribe`의 요청/응답
계약(상태 코드, 응답 스키마, 세그먼트 필수 필드, 잘못된 base64 처리 등)이지
STT 모델의 인식 품질이 아니다. 그래서 실제 Qwen3-ASR을 GPU에 로드하는 대신
스텁 어댑터(`_StubSttAdapter`)를 `app.state.stt_adapter`에 직접 주입한다
(test_health_embed_state.py·test_warmup.py와 동일한 패턴 — lifespan 없이
TestClient를 만들고 app.state에 필요한 것만 채운다).

과거 이 파일은 `with TestClient(app) as c:`로 매 테스트마다 lifespan을 태워
실제 1.7B 모델을 GPU에 로드했고(테스트마다 수 초~수십 초), 그 중 하나는
무음 PCM에서 텍스트가 나오길 기대해 항상 실패했다(무음 → 빈 배열이 STT
모델로서는 정답 — 텍스트가 나오면 그게 환각이다). 스텁으로 바꾸며 그 기대를
"무음 → 빈 배열"로 정정했다(아래 무음 관련 테스트 참조).
"""
import asyncio
import base64

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app.stt.base import TranscriptSegment

# 3초치 PCM(16kHz mono Int16 = 32000 bytes/sec 기준 96000 bytes).
_AUDIO_SILENT = b"\x00" * 96000  # 전부 0 → 무음
_AUDIO_SPEECH = b"\x00\x01" * 48000  # 전부 0은 아님 → 스텁이 "발화 있음"으로 취급


def _b64(audio: bytes) -> str:
    return base64.b64encode(audio).decode()


class _StubSttAdapter:
    """검증용 스텁 STT 어댑터.

    실제 Qwen3-ASR 대신 결정적 응답을 반환해 라우터의 요청/응답 계약만
    검증한다. 전부 0인 PCM(무음)이면 실제 엔진과 동일하게 빈 리스트를
    반환하고, 그 외에는 필수 필드가 채워진 고정 더미 세그먼트를 반환한다.
    """

    async def transcribe(self, audio_chunk: bytes, languages=None, mode="single"):
        if not any(audio_chunk):
            return []
        return [
            TranscriptSegment(
                text="테스트 발화입니다",
                started_at_ms=0,
                ended_at_ms=3000,
                language="ko",
                confidence=0.97,
                speaker_label=None,
            )
        ]


# ── fixture: lifespan 없는 TestClient + 스텁 어댑터 주입 ─────────────────────
@pytest.fixture()
def client():
    """lifespan(=실제 모델 로드)을 태우지 않고, 라우터가 참조하는 app.state만
    스텁으로 채운다. /transcribe·/ws/transcribe 둘 다 gpu_lock을 잡으므로
    같이 채워야 한다."""
    from app.main import app
    c = TestClient(app)
    c.app.state.stt_adapter = _StubSttAdapter()
    c.app.state.gpu_lock = asyncio.Lock()
    return c


# ── POST /transcribe ─────────────────────────────────────────────────────────
def test_transcribe_post_returns_200(client):
    response = client.post("/transcribe", json={"audio": _b64(_AUDIO_SPEECH)})
    assert response.status_code == 200


def test_transcribe_post_response_has_segments(client):
    response = client.post("/transcribe", json={"audio": _b64(_AUDIO_SPEECH)})
    data = response.json()
    assert "segments" in data
    assert isinstance(data["segments"], list)


def test_transcribe_post_segment_has_required_fields(client):
    response = client.post("/transcribe", json={"audio": _b64(_AUDIO_SPEECH)})
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


# ── 무음 입력: 빈 세그먼트가 정답 ─────────────────────────────────────────────
def test_transcribe_post_silence_returns_empty_segments(client):
    """무음(전부 0인 PCM) 입력은 빈 세그먼트 배열을 반환해야 한다.

    과거 이 파일의 실패 원인이었던 케이스: 무음에서 텍스트가 나오면 환각이므로
    빈 배열이 올바른 동작이다. 실제 Qwen3-ASR도 동일하게 동작한다.
    """
    response = client.post("/transcribe", json={"audio": _b64(_AUDIO_SILENT)})
    assert response.status_code == 200
    assert response.json()["segments"] == []


# ── WS /ws/transcribe (TestClient 경유 — 실제 응답이 오는 경로만) ─────────────
def test_ws_transcribe_connects(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        assert ws is not None


def test_ws_transcribe_receives_final_message(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data = ws.receive_json()
        assert data["type"] in ("partial", "final")


def test_ws_transcribe_message_has_required_fields(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data = ws.receive_json()
        assert "type" in data
        assert "text" in data
        assert "started_at_ms" in data
        assert "ended_at_ms" in data
        assert "seq" in data


def test_ws_transcribe_message_type_is_final(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data = ws.receive_json()
        assert data["type"] == "final"


def test_ws_transcribe_seq_increments(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data1 = ws.receive_json()
        ws.send_bytes(_AUDIO_SPEECH)
        data2 = ws.receive_json()
        assert data2["seq"] > data1["seq"]


def test_ws_transcribe_speaker_field_present(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data = ws.receive_json()
        assert "speaker" in data


def test_ws_transcribe_text_is_string(client):
    with client.websocket_connect("/ws/transcribe") as ws:
        ws.send_bytes(_AUDIO_SPEECH)
        data = ws.receive_json()
        assert isinstance(data["text"], str)


# ── WS 무음 입력: 메시지가 전송되지 않아야 한다 ──────────────────────────────
# TestClient.websocket_connect로 무음 청크만 보내면 서버가 어떤 메시지도
# 보내지 않아 receive_json()이 응답 없이 계속 대기한다(=행). 그래서 이 케이스는
# TestClient 왕복 대신 ws_transcribe()를 duck-typed fake websocket으로 직접
# 호출해 "송신 여부"를 검증한다 — test_gpu_lock_interleaving.py의
# _FakeWebSocket 패턴을 그대로 따른다.
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


async def test_ws_transcribe_silence_sends_no_message():
    """무음 청크는 세그먼트가 없으므로 클라이언트에 아무 메시지도 보내지 않는다."""
    from app.routers.stt import ws_transcribe

    fake_app = _FakeWSApp(_StubSttAdapter(), asyncio.Lock())
    ws = _FakeWebSocket(fake_app, [_AUDIO_SILENT])

    await ws_transcribe(ws)

    assert ws.sent == []


async def test_ws_transcribe_speech_after_silence_only_sends_for_speech():
    """무음 다음에 발화 청크가 오면, 무음은 건너뛰고 발화 청크만 메시지로 전송된다."""
    from app.routers.stt import ws_transcribe

    fake_app = _FakeWSApp(_StubSttAdapter(), asyncio.Lock())
    ws = _FakeWebSocket(fake_app, [_AUDIO_SILENT, _AUDIO_SPEECH])

    await ws_transcribe(ws)

    assert len(ws.sent) == 1
    assert ws.sent[0]["type"] == "final"
