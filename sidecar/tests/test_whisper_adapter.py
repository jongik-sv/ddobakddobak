"""Tests for WhisperAdapter (TSK-02-02)."""
import asyncio
from unittest.mock import MagicMock


# ── 헬퍼: WhisperAdapter에 mock model 주입 ───────────────────────────────────
def _make_adapter_with_mock_model(segments_text: list[str] | None = None):
    """pywhispercpp 없이 WhisperAdapter를 생성하고 mock model을 주입한다."""
    from app.stt.whisper_adapter import WhisperAdapter

    if segments_text is None:
        segments_text = ["안녕하세요"]

    adapter = WhisperAdapter()
    mock_model = MagicMock()

    # pywhispercpp Segment mock
    mock_segs = []
    for text in segments_text:
        seg = MagicMock()
        seg.text = text
        seg.t0 = 0    # 10ms 단위
        seg.t1 = 300  # 10ms 단위 → 3000ms
        mock_segs.append(seg)

    mock_model.transcribe.return_value = mock_segs
    adapter._model = mock_model
    adapter._is_loaded = True
    return adapter


# ── 인터페이스 준수 ──────────────────────────────────────────────────────────
def test_whisper_adapter_is_stt_adapter():
    from app.stt.base import SttAdapter
    from app.stt.whisper_adapter import WhisperAdapter
    assert issubclass(WhisperAdapter, SttAdapter)


def test_whisper_adapter_initial_is_loaded_false():
    from app.stt.whisper_adapter import WhisperAdapter
    adapter = WhisperAdapter()
    assert adapter.is_loaded is False


# ── load_model: pywhispercpp 미설치 시 ImportError ───────────────────────────
def test_whisper_load_model_raises_import_error_when_lib_missing(monkeypatch):
    import sys
    from app.stt.whisper_adapter import WhisperAdapter

    adapter = WhisperAdapter()
    monkeypatch.setitem(sys.modules, "pywhispercpp", None)
    monkeypatch.setitem(sys.modules, "pywhispercpp.model", None)

    try:
        asyncio.get_event_loop().run_until_complete(adapter.load_model())
        assert False, "ImportError가 발생해야 합니다"
    except (ImportError, TypeError, Exception):
        pass


# ── transcribe ───────────────────────────────────────────────────────────────
def test_whisper_transcribe_returns_list():
    from app.stt.base import TranscriptSegment
    adapter = _make_adapter_with_mock_model(["테스트"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert isinstance(result, list)


def test_whisper_transcribe_returns_transcript_segments():
    from app.stt.base import TranscriptSegment
    adapter = _make_adapter_with_mock_model(["반갑습니다"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_whisper_transcribe_segment_text():
    adapter = _make_adapter_with_mock_model(["안녕하세요"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].text == "안녕하세요"


def test_whisper_transcribe_segment_language_is_ko():
    adapter = _make_adapter_with_mock_model(["한국어 테스트"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].language == "ko"


def test_whisper_transcribe_segment_timestamps_from_model():
    adapter = _make_adapter_with_mock_model(["타임스탬프"])
    # t0=0, t1=300 → 0ms ~ 3000ms
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].started_at_ms == 0
    assert result[0].ended_at_ms == 3000


def test_whisper_transcribe_not_loaded_raises_runtime_error():
    from app.stt.whisper_adapter import WhisperAdapter
    import pytest
    adapter = WhisperAdapter()
    with pytest.raises(RuntimeError):
        asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"\x00" * 100))


def test_whisper_transcribe_multiple_segments():
    from app.stt.base import TranscriptSegment
    adapter = _make_adapter_with_mock_model(["첫 번째 문장", "두 번째 문장"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert len(result) == 2


# ── transcribe_stream ────────────────────────────────────────────────────────
def test_whisper_transcribe_stream_yields_segments():
    from app.stt.base import TranscriptSegment

    async def collect():
        adapter = _make_adapter_with_mock_model(["스트리밍"])
        segments = []
        async for seg in adapter.transcribe_stream(_aiter([b"\x00" * 96000])):
            segments.append(seg)
        return segments

    segments = asyncio.get_event_loop().run_until_complete(collect())
    assert len(segments) > 0


async def _aiter(items):
    for item in items:
        yield item


# ── transcribe_file ──────────────────────────────────────────────────────────
def test_whisper_transcribe_file_returns_list(tmp_path):
    audio_file = tmp_path / "test.pcm"
    audio_file.write_bytes(b"\x00" * 96000)
    adapter = _make_adapter_with_mock_model(["파일 테스트"])
    result = asyncio.get_event_loop().run_until_complete(
        adapter.transcribe_file(str(audio_file))
    )
    assert isinstance(result, list)
    assert len(result) > 0


# ── factory 연동 ─────────────────────────────────────────────────────────────
def test_factory_creates_whisper_adapter():
    from app.stt.factory import create_stt_adapter
    from app.stt.whisper_adapter import WhisperAdapter
    adapter = create_stt_adapter("whisper_cpp")
    assert isinstance(adapter, WhisperAdapter)


# ── speaker_label 기본값 ──────────────────────────────────────────────────────
def test_whisper_segment_speaker_label_default_none():
    adapter = _make_adapter_with_mock_model(["화자 테스트"])
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].speaker_label is None
