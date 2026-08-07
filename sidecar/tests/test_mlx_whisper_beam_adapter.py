"""Characterization tests for MLXWhisperBeamAdapter.transcribe() (WP-S2).

_run_inference (vendored beam 백엔드 호출)만 monkeypatch하고, 언어 결정·환각 필터·
세그먼트 매핑 등 transcribe() 본문 로직을 고정한다. MLXWhisperAdapter와 동일 계약이므로
같은 케이스를 미러링한다. 리팩토링(공통 후처리 추출) 전후 동일하게 통과해야 한다.
"""
import numpy as np
import pytest

from app.stt.mlx_whisper_beam_adapter import MLXWhisperBeamAdapter


def _pcm(n_samples: int = 16000) -> bytes:
    return np.zeros(n_samples, dtype=np.int16).tobytes()


@pytest.fixture
def adapter():
    a = MLXWhisperBeamAdapter()
    a._is_loaded = True
    return a


async def test_transcribe_raises_if_not_loaded():
    a = MLXWhisperBeamAdapter()
    with pytest.raises(RuntimeError):
        await a.transcribe(_pcm())


async def test_empty_audio_returns_empty_list(adapter):
    result = await adapter.transcribe(b"", languages=["ko"], mode="single")
    assert result == []


async def test_single_mode_forces_iso_lang(adapter, monkeypatch):
    captured = {}

    async def fake_run_inference(audio_array, language):
        captured["language"] = language
        return [{"text": "안녕하세요", "start": 0.0, "end": 1.0, "avg_logprob": -0.2}], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="single")

    assert captured["language"] == "ko"
    assert len(segs) == 1
    assert segs[0].language == "ko"


async def test_multi_mode_auto_detect_and_seg_language(adapter, monkeypatch):
    captured = {}

    async def fake_run_inference(audio_array, language):
        captured["language"] = language
        return [{"text": "hello world", "start": 0.0, "end": 1.0}], "en"

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")

    assert captured["language"] is None
    assert len(segs) == 1
    assert segs[0].language == "en"


async def test_multi_mode_no_detected_language_defaults_to_ko(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [{"text": "안녕하세요", "start": 0.0, "end": 1.0}], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="multi")

    assert segs[0].language == "ko"


async def test_single_mode_no_languages_defaults_to_ko(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [{"text": "안녕하세요", "start": 0.0, "end": 1.0}], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=None, mode="single")

    assert segs[0].language == "ko"


async def test_segment_mapping_ms_and_confidence(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [
            {"text": "안녕하세요", "start": 1.5, "end": 3.25, "avg_logprob": -0.42},
        ], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="single")

    assert len(segs) == 1
    seg = segs[0]
    assert seg.text == "안녕하세요"
    assert seg.started_at_ms == 1500
    assert seg.ended_at_ms == 3250
    assert seg.confidence == pytest.approx(-0.42)


async def test_segment_missing_avg_logprob_defaults_confidence(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [{"text": "안녕하세요", "start": 0.0, "end": 1.0}], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="single")

    assert segs[0].confidence == pytest.approx(0.85)


async def test_hallucination_segment_filtered_out(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [
            {"text": "어", "start": 0.0, "end": 0.1},  # 짧은 환각 후보
            {"text": "안녕하세요 반갑습니다", "start": 0.1, "end": 1.0},
        ], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="single")

    assert len(segs) == 1
    assert segs[0].text == "안녕하세요 반갑습니다"


async def test_empty_text_segment_dropped(adapter, monkeypatch):
    async def fake_run_inference(audio_array, language):
        return [
            {"text": "   ", "start": 0.0, "end": 0.1},
            {"text": "안녕하세요 반갑습니다", "start": 0.1, "end": 1.0},
        ], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="single")

    assert len(segs) == 1


async def test_repetition_collapsed_in_text(adapter, monkeypatch):
    repeated = "안녕" * 5

    async def fake_run_inference(audio_array, language):
        return [{"text": repeated, "start": 0.0, "end": 1.0}], None

    monkeypatch.setattr(adapter, "_run_inference", fake_run_inference)
    segs = await adapter.transcribe(_pcm(), languages=["ko"], mode="single")

    assert len(segs) == 1
    assert segs[0].text == "안녕안녕"
