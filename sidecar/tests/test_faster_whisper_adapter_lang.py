import numpy as np
import pytest

from app.stt.faster_whisper_adapter import FasterWhisperAdapter


class _Seg:
    def __init__(self, text, start=0.0, end=0.1, avg_logprob=-0.1):
        self.text = text
        self.start = start
        self.end = end
        self.avg_logprob = avg_logprob


class _Info:
    def __init__(self, language):
        self.language = language


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def transcribe(self, audio, language=None, vad_filter=True):
        self.last_language = language
        return iter([_Seg("안녕하세요")]), _Info("zh")


@pytest.fixture
def adapter():
    a = FasterWhisperAdapter()
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
async def test_multi_mode_records_info_language(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language is None
    assert segs and segs[0].language == "zh"
