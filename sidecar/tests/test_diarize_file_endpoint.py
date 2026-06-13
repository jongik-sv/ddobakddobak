"""POST /diarize-file — 재전사 없이 화자분리만 재실행하는 엔드포인트 검증."""
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.stt.base import TranscriptSegment


@pytest.fixture
def pcm_file(tmp_path):
    """1초 분량 이상의 더미 PCM 파일 (내용은 mock이 무시하므로 길이만 중요치 않음)."""
    f = tmp_path / "audio.pcm"
    f.write_bytes(b"\x00\x01" * 16000)  # 1초치 Int16 mono @16kHz
    return f


async def test_diarize_file_reassigns_speaker_labels(pcm_file, monkeypatch):
    """입력 세그먼트에 화자 라벨이 재할당되고, ahc_threshold가 전달되는지 확인."""
    captured = {}

    async def fake_diarize(audio_bytes, segments, meeting_id=None, ahc_threshold=None, **kwargs):
        captured["ahc_threshold"] = ahc_threshold
        captured["meeting_id"] = meeting_id
        captured["n_segments"] = len(segments)
        labels = ["화자 1", "화자 2"]
        for i, seg in enumerate(segments):
            seg.speaker_label = labels[i % len(labels)]
        return segments

    mock = AsyncMock(side_effect=fake_diarize)
    # stt.py가 함수 내부에서 lazy import 하므로 원본 모듈 심볼을 패치한다
    monkeypatch.setattr(
        "app.diarization.batch_processor.batch_diarize_speakrs", mock
    )

    payload = {
        "file_path": str(pcm_file),
        "meeting_id": 7,
        "segments": [
            {"started_at_ms": 0, "ended_at_ms": 1000},
            {"started_at_ms": 1000, "ended_at_ms": 2000},
        ],
        "diarization_config": {"ahc_threshold": 0.4},
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/diarize-file", json=payload)

    assert res.status_code == 200
    body = res.json()
    assert len(body["segments"]) == 2
    for seg in body["segments"]:
        assert seg["speaker_label"]  # 비어있지 않은 라벨
        assert "started_at_ms" in seg and "ended_at_ms" in seg
    assert body["segments"][0]["speaker_label"] == "화자 1"
    assert body["segments"][1]["speaker_label"] == "화자 2"

    # ahc_threshold가 그대로 전달되었는지
    assert captured["ahc_threshold"] == 0.4
    assert captured["meeting_id"] == 7
    assert captured["n_segments"] == 2
    mock.assert_awaited_once()
    assert mock.await_args.kwargs["ahc_threshold"] == 0.4


async def test_diarize_file_missing_file_returns_400(monkeypatch):
    payload = {
        "file_path": "/nonexistent/path/audio.pcm",
        "segments": [{"started_at_ms": 0, "ended_at_ms": 1000}],
        "diarization_config": {"ahc_threshold": 0.5},
    }
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/diarize-file", json=payload)
    assert res.status_code == 400


async def test_diarize_file_returns_input_on_failure(pcm_file, monkeypatch):
    """diarize 실패 시 500 대신 입력 세그먼트를 그대로(라벨 없이) 반환."""
    async def boom(*args, **kwargs):
        raise RuntimeError("speakrs crashed")

    monkeypatch.setattr(
        "app.diarization.batch_processor.batch_diarize_speakrs",
        AsyncMock(side_effect=boom),
    )

    payload = {
        "file_path": str(pcm_file),
        "segments": [
            {"started_at_ms": 0, "ended_at_ms": 1000},
            {"started_at_ms": 1000, "ended_at_ms": 2000},
        ],
        "diarization_config": {"ahc_threshold": 0.4},
    }
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/diarize-file", json=payload)

    assert res.status_code == 200
    body = res.json()
    assert len(body["segments"]) == 2
    assert body["segments"][0]["started_at_ms"] == 0
    assert body["segments"][0]["speaker_label"] == ""  # 실패 → 라벨 비어있음
