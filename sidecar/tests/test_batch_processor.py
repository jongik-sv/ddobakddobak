"""batch_diarize 단위 테스트 — fake pyannote pipeline으로 검증."""
import json

import numpy as np
import pytest

from app.diarization.batch_processor import batch_diarize
from app.stt.base import TranscriptSegment


class _FakeTurn:
    def __init__(self, start: float, end: float):
        self.start = start
        self.end = end


class _FakeAnnotation:
    """pyannote Annotation 흉내: itertracks/labels만 구현."""

    def __init__(self, tracks):  # tracks: [(start_s, end_s, label)]
        self._tracks = tracks

    def labels(self):
        seen = []
        for _, _, lab in self._tracks:
            if lab not in seen:
                seen.append(lab)
        return seen

    def itertracks(self, yield_label=False):
        for start, end, lab in self._tracks:
            yield _FakeTurn(start, end), None, lab


class _FakeOutput:
    def __init__(self, tracks, embeddings, exclusive_tracks=None):
        self.speaker_diarization = _FakeAnnotation(tracks)
        self.exclusive_speaker_diarization = _FakeAnnotation(
            exclusive_tracks if exclusive_tracks is not None else tracks
        )
        self.speaker_embeddings = embeddings


class _FakePipeline:
    def __init__(self, tracks, embeddings, exclusive_tracks=None):
        self._out = _FakeOutput(tracks, embeddings, exclusive_tracks)

    def __call__(self, audio_input):
        return self._out


def _segments():
    return [
        TranscriptSegment(text="안녕하세요", started_at_ms=0, ended_at_ms=2000,
                          language="ko", confidence=0.9),
        TranscriptSegment(text="네 반갑습니다", started_at_ms=2500, ended_at_ms=4500,
                          language="ko", confidence=0.9),
    ]


@pytest.fixture
def audio_bytes():
    # 5초 무음 PCM 16kHz mono Int16
    return b"\x00\x00" * 16000 * 5


async def test_assigns_speakers_from_diarization(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32), -np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(
        tracks=[(0.0, 2.2, "SPEAKER_00"), (2.3, 5.0, "SPEAKER_01")],
        embeddings=emb,
    )
    segments = await batch_diarize(audio_bytes, pipeline, _segments(),
                                   meeting_id=99, db_dir=tmp_path)
    assert segments[0].speaker_label == "화자 1"
    assert segments[1].speaker_label == "화자 2"


async def test_registers_embeddings_in_speaker_db(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32), -np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(
        tracks=[(0.0, 2.2, "SPEAKER_00"), (2.3, 5.0, "SPEAKER_01")],
        embeddings=emb,
    )
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=99, db_dir=tmp_path)
    db_file = tmp_path / "meeting_99.json"
    assert db_file.exists()
    data = json.loads(db_file.read_text())
    assert set(data["speakers"].keys()) == {"화자 1", "화자 2"}


async def test_preserves_existing_speaker_names_on_rerun(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(tracks=[(0.0, 5.0, "SPEAKER_00")], embeddings=emb)
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=7, db_dir=tmp_path)
    # 사용자가 이름 부여했다고 가정
    db_file = tmp_path / "meeting_7.json"
    data = json.loads(db_file.read_text())
    data["names"] = {"화자 1": "김철수"}
    db_file.write_text(json.dumps(data, ensure_ascii=False))
    # 재실행(regenerate_stt 시나리오) — 이름 유지
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=7, db_dir=tmp_path)
    data2 = json.loads(db_file.read_text())
    assert data2["names"].get("화자 1") == "김철수"


async def test_prefers_exclusive_timeline_over_raw_diarization(audio_bytes, tmp_path):
    """겹침 발화 시 exclusive_speaker_diarization(비겹침)이 우선해야 한다.

    raw 타임라인에서는 seg[1](2500~4500ms)이 화자 1(겹침 2000ms) > 화자 2(겹침
    1500ms)로 강제 배정되므로, '화자 2' 단언은 exclusive 경로로만 통과 가능.
    """
    emb = np.stack([np.ones(256, dtype=np.float32), -np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(
        tracks=[(0.0, 5.0, "SPEAKER_00"), (2.3, 4.0, "SPEAKER_01")],  # 겹침 발화
        embeddings=emb,
        exclusive_tracks=[(0.0, 2.2, "SPEAKER_00"), (2.3, 5.0, "SPEAKER_01")],
    )
    segments = await batch_diarize(audio_bytes, pipeline, _segments(),
                                   meeting_id=42, db_dir=tmp_path)
    assert segments[0].speaker_label == "화자 1"
    assert segments[1].speaker_label == "화자 2"


async def test_no_embeddings_still_assigns_labels(audio_bytes, tmp_path):
    pipeline = _FakePipeline(tracks=[(0.0, 5.0, "SPEAKER_00")], embeddings=None)
    segments = await batch_diarize(audio_bytes, pipeline, _segments(),
                                   meeting_id=5, db_dir=tmp_path)
    assert segments[0].speaker_label == "화자 1"
