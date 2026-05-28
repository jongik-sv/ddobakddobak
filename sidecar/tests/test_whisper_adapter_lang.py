import numpy as np
import pytest

from app.stt.whisper_adapter import WhisperAdapter


class _Seg:
    def __init__(self, text, t0=0, t1=100):
        self.text = text
        self.t0 = t0
        self.t1 = t1


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def transcribe(self, audio_array, language="auto"):
        self.last_language = language
        return [_Seg("안녕하세요")]

    def auto_detect_language(self, audio_array):
        # ((detected, prob), all_probs)
        return (("zh", 0.9), {})


@pytest.fixture
def adapter():
    a = WhisperAdapter()
    a._model = _FakeModel()
    a._is_loaded = True
    return a


def _pcm():
    return np.zeros(16000, dtype=np.int16).tobytes()


@pytest.mark.asyncio
async def test_single_mode_forces_iso(adapter):
    await adapter.transcribe(_pcm(), languages=["ko"], mode="single")
    assert adapter._model.last_language == "ko"


@pytest.mark.asyncio
async def test_multi_mode_auto_and_records_detected(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language == "auto"
    assert segs and segs[0].language == "zh"
