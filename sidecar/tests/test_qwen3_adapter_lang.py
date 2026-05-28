import numpy as np
import pytest

from app.stt.qwen3_adapter import Qwen3Adapter


class _FakeResult:
    def __init__(self, text, language):
        self.text = text
        self.language = language  # mlx STTOutput.language 는 세그먼트별 리스트


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def generate(self, audio_array, language=None):
        self.last_language = language
        detected = language if language else "Chinese"
        return _FakeResult("테스트 발화", [detected])


@pytest.fixture
def adapter():
    a = Qwen3Adapter()
    a._model = _FakeModel()
    a._is_loaded = True
    return a


def _pcm(seconds=1.0):
    return (np.zeros(int(16000 * seconds), dtype=np.int16)).tobytes()


@pytest.mark.asyncio
async def test_single_mode_forces_fullname(adapter):
    await adapter.transcribe(_pcm(), languages=["ko"], mode="single")
    assert adapter._model.last_language == "Korean"


@pytest.mark.asyncio
async def test_multi_mode_passes_none_and_records_detected_iso(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language is None
    assert segs and segs[0].language == "zh"  # Chinese → 정규화 zh
