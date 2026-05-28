import pytest

from app.stt.mock_adapter import MockAdapter


@pytest.mark.asyncio
async def test_mock_transcribe_accepts_mode():
    adapter = MockAdapter()
    await adapter.load_model()
    segs = await adapter.transcribe(b"\x00" * 3200, languages=["ko"], mode="multi")
    assert len(segs) == 1
    assert segs[0].text == MockAdapter.DUMMY_TEXT
