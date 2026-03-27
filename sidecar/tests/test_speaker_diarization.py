"""Tests for SpeakerDiarizer (TSK-02-03)."""
import asyncio
from unittest.mock import MagicMock, patch


# ── 헬퍼 ────────────────────────────────────────────────────────────────────
def _make_diarizer_with_mock_pipeline(speaker_map: dict | None = None):
    """pyannote 없이 SpeakerDiarizer를 생성하고 mock pipeline을 주입한다.

    Args:
        speaker_map: {(start_sec, end_sec, speaker_label): ...} 형태의 diarization 결과.
                     None이면 단일 화자 결과를 반환.
    """
    from app.diarization.speaker import SpeakerDiarizer

    diarizer = SpeakerDiarizer()

    # pipeline mock 생성
    mock_pipeline = MagicMock()
    if speaker_map is None:
        # 기본: 0~3초 SPEAKER_00
        speaker_map = {(0.0, 3.0): "SPEAKER_00"}

    # itertracks mock
    def itertracks(yield_label=False):
        for (start, end), label in speaker_map.items():
            turn = MagicMock()
            turn.start = start
            turn.end = end
            yield turn, None, label

    mock_result = MagicMock()
    mock_result.itertracks = itertracks
    mock_pipeline.return_value = mock_result
    diarizer._pipeline = mock_pipeline
    diarizer._is_loaded = True
    return diarizer


def _make_segments(specs: list[tuple[int, int, str | None]] | None = None):
    """테스트용 TranscriptSegment 리스트 생성.

    Args:
        specs: [(started_at_ms, ended_at_ms, text), ...]
    """
    from app.stt.base import TranscriptSegment
    if specs is None:
        specs = [(0, 3000, "안녕하세요"), (3000, 6000, "반갑습니다")]
    return [
        TranscriptSegment(text=text, started_at_ms=start, ended_at_ms=end)
        for start, end, text in specs
    ]


# ── 모듈 구조 ────────────────────────────────────────────────────────────────
def test_speaker_diarizer_importable():
    from app.diarization.speaker import SpeakerDiarizer
    assert SpeakerDiarizer is not None


def test_speaker_diarizer_initial_not_loaded():
    from app.diarization.speaker import SpeakerDiarizer
    d = SpeakerDiarizer()
    assert d.is_loaded is False


# ── load: pyannote 미설치 시 ImportError ─────────────────────────────────────
def test_speaker_diarizer_load_raises_import_error_when_missing(monkeypatch):
    import sys
    from app.diarization.speaker import SpeakerDiarizer

    d = SpeakerDiarizer()
    monkeypatch.setitem(sys.modules, "pyannote", None)
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)

    try:
        asyncio.get_event_loop().run_until_complete(d.load(hf_token="fake"))
        assert False, "ImportError가 발생해야 합니다"
    except (ImportError, TypeError, Exception):
        pass


# ── diarize ──────────────────────────────────────────────────────────────────
def test_diarize_returns_dict():
    diarizer = _make_diarizer_with_mock_pipeline()
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(diarizer.diarize(audio))
    assert isinstance(result, dict)


def test_diarize_result_keys_are_ms_tuples():
    diarizer = _make_diarizer_with_mock_pipeline({(0.0, 3.0): "SPEAKER_00"})
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(diarizer.diarize(audio))
    for key in result.keys():
        start_ms, end_ms = key
        assert isinstance(start_ms, int)
        assert isinstance(end_ms, int)


def test_diarize_result_values_are_speaker_labels():
    diarizer = _make_diarizer_with_mock_pipeline({(0.0, 3.0): "SPEAKER_00"})
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(diarizer.diarize(audio))
    for label in result.values():
        assert isinstance(label, str)


def test_diarize_not_loaded_raises_runtime_error():
    from app.diarization.speaker import SpeakerDiarizer
    import pytest
    d = SpeakerDiarizer()
    with pytest.raises(RuntimeError):
        asyncio.get_event_loop().run_until_complete(d.diarize(b"\x00" * 100))


# ── merge_with_segments ───────────────────────────────────────────────────────
def test_merge_with_segments_returns_segments():
    from app.stt.base import TranscriptSegment
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([(0, 3000, "안녕하세요")])
    diarization = {(0, 3000): "화자 1"}
    result = diarizer.merge_with_segments(segments, diarization)
    assert isinstance(result, list)
    assert all(isinstance(s, TranscriptSegment) for s in result)


def test_merge_assigns_speaker_label():
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([(0, 3000, "안녕하세요")])
    diarization = {(0, 3000): "화자 1"}
    result = diarizer.merge_with_segments(segments, diarization)
    assert result[0].speaker_label == "화자 1"


def test_merge_two_speakers():
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([
        (0, 3000, "첫 번째 화자"),
        (3000, 6000, "두 번째 화자"),
    ])
    diarization = {
        (0, 3000): "화자 1",
        (3000, 6000): "화자 2",
    }
    result = diarizer.merge_with_segments(segments, diarization)
    assert result[0].speaker_label == "화자 1"
    assert result[1].speaker_label == "화자 2"


def test_merge_no_matching_speaker_label_is_none():
    """diarization 결과와 겹치지 않는 세그먼트는 speaker_label=None."""
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([(10000, 13000, "겹치지 않는 세그먼트")])
    diarization = {(0, 3000): "화자 1"}
    result = diarizer.merge_with_segments(segments, diarization)
    assert result[0].speaker_label is None


def test_merge_preserves_segment_text():
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([(0, 3000, "원본 텍스트")])
    diarization = {(0, 3000): "화자 1"}
    result = diarizer.merge_with_segments(segments, diarization)
    assert result[0].text == "원본 텍스트"


def test_merge_same_speaker_multiple_segments():
    """같은 화자가 여러 세그먼트를 말할 때 동일한 label."""
    diarizer = _make_diarizer_with_mock_pipeline()
    segments = _make_segments([
        (0, 1500, "첫 문장"),
        (1500, 3000, "두 번째 문장"),
    ])
    diarization = {(0, 3000): "화자 1"}
    result = diarizer.merge_with_segments(segments, diarization)
    assert result[0].speaker_label == "화자 1"
    assert result[1].speaker_label == "화자 1"
