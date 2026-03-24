"""Tests for STT Factory pattern and MockAdapter."""
import pytest
import asyncio


def test_create_mock_adapter_returns_mock_instance():
    from app.stt.factory import create_stt_adapter
    from app.stt.mock_adapter import MockAdapter
    adapter = create_stt_adapter("mock")
    assert isinstance(adapter, MockAdapter)


def test_create_adapter_with_unknown_engine_raises_value_error():
    from app.stt.factory import create_stt_adapter
    with pytest.raises(ValueError, match="Unknown STT engine"):
        create_stt_adapter("nonexistent_engine")


def test_mock_adapter_is_loaded_initially_false():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    assert adapter.is_loaded is False


def test_mock_adapter_load_model_sets_is_loaded_true():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    assert adapter.is_loaded is True


def test_mock_adapter_transcribe_returns_list():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"fake_audio"))
    assert isinstance(result, list)
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_mock_adapter_transcribe_segment_has_text():
    from app.stt.mock_adapter import MockAdapter
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"fake_audio"))
    assert isinstance(result[0].text, str)
    assert len(result[0].text) > 0


def test_mock_adapter_transcribe_file_returns_list():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment
    adapter = MockAdapter()
    asyncio.get_event_loop().run_until_complete(adapter.load_model())
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe_file("/fake/path.wav"))
    assert isinstance(result, list)
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_mock_adapter_transcribe_stream_yields_segments():
    from app.stt.mock_adapter import MockAdapter
    from app.stt.base import TranscriptSegment

    async def collect_stream():
        adapter = MockAdapter()
        await adapter.load_model()
        segments = []
        async for seg in adapter.transcribe_stream(iter([b"chunk1", b"chunk2"])):
            segments.append(seg)
        return segments

    segments = asyncio.get_event_loop().run_until_complete(collect_stream())
    assert len(segments) > 0
    assert isinstance(segments[0], TranscriptSegment)


def test_transcript_segment_fields():
    from app.stt.base import TranscriptSegment
    seg = TranscriptSegment(
        text="테스트 텍스트",
        started_at_ms=0,
        ended_at_ms=3000,
        language="ko",
        confidence=0.95,
    )
    assert seg.text == "테스트 텍스트"
    assert seg.started_at_ms == 0
    assert seg.ended_at_ms == 3000
    assert seg.language == "ko"
    assert seg.confidence == 0.95


def test_transcript_segment_default_values():
    from app.stt.base import TranscriptSegment
    seg = TranscriptSegment(text="hello", started_at_ms=0, ended_at_ms=1000)
    assert seg.language == "ko"
    assert seg.confidence == 0.0
