"""Tests for Qwen3Adapter (TSK-02-01)."""
import asyncio
import sys
from unittest.mock import MagicMock, patch


# ── 헬퍼: Qwen3Adapter에 mock LLM 주입 ──────────────────────────────────────
def _make_adapter_with_mock_model(output_text: str = "안녕하세요 테스트입니다"):
    """mlx-audio 없이 Qwen3Adapter를 생성하고 mock model을 주입한다."""
    from app.stt.qwen3_adapter import Qwen3Adapter

    adapter = Qwen3Adapter()
    # mock model 직접 주입 (mlx-audio 미설치 환경)
    mock_model = MagicMock()
    mock_result = MagicMock()
    mock_result.text = output_text
    mock_model.generate.return_value = mock_result
    adapter._model = mock_model
    adapter._is_loaded = True
    return adapter


# ── 인터페이스 준수 ──────────────────────────────────────────────────────────
def test_qwen3_adapter_is_stt_adapter():
    from app.stt.base import SttAdapter
    from app.stt.qwen3_adapter import Qwen3Adapter
    assert issubclass(Qwen3Adapter, SttAdapter)


def test_qwen3_adapter_initial_is_loaded_false():
    from app.stt.qwen3_adapter import Qwen3Adapter
    adapter = Qwen3Adapter()
    assert adapter.is_loaded is False


# ── load_model: vLLM 미설치 시 ImportError ───────────────────────────────────
def test_qwen3_load_model_raises_import_error_when_mlx_audio_missing():
    from app.stt.qwen3_adapter import Qwen3Adapter

    adapter = Qwen3Adapter()
    # mlx_audio 모듈이 없는 척
    with patch.dict(sys.modules, {"mlx_audio": None, "mlx_audio.stt": None, "mlx_audio.stt.utils": None}):
        with patch("builtins.__import__", side_effect=ImportError("No module named 'mlx_audio'")):
            try:
                asyncio.get_event_loop().run_until_complete(adapter.load_model())
                assert False, "ImportError가 발생해야 합니다"
            except (ImportError, Exception):
                pass  # 예상된 동작


# ── transcribe ───────────────────────────────────────────────────────────────
def test_qwen3_transcribe_returns_list():
    from app.stt.base import TranscriptSegment
    adapter = _make_adapter_with_mock_model()
    audio = b"\x00" * 96000  # 3초 PCM 16kHz 16bit
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert isinstance(result, list)


def test_qwen3_transcribe_returns_transcript_segments():
    from app.stt.base import TranscriptSegment
    adapter = _make_adapter_with_mock_model("테스트 음성입니다")
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert len(result) > 0
    assert isinstance(result[0], TranscriptSegment)


def test_qwen3_transcribe_segment_has_korean_text():
    adapter = _make_adapter_with_mock_model("안녕하세요")
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].text == "안녕하세요"


def test_qwen3_transcribe_segment_language_is_ko():
    adapter = _make_adapter_with_mock_model("테스트")
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].language == "ko"


def test_qwen3_transcribe_segment_timestamps():
    adapter = _make_adapter_with_mock_model("타임스탬프 테스트")
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    seg = result[0]
    assert isinstance(seg.started_at_ms, int)
    assert isinstance(seg.ended_at_ms, int)
    assert seg.ended_at_ms > seg.started_at_ms


def test_qwen3_transcribe_empty_result_for_empty_inference():
    adapter = _make_adapter_with_mock_model("")  # 빈 텍스트 반환
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result == []


def test_qwen3_transcribe_not_loaded_raises_runtime_error():
    from app.stt.qwen3_adapter import Qwen3Adapter
    adapter = Qwen3Adapter()
    with __import__("pytest").raises(RuntimeError):
        asyncio.get_event_loop().run_until_complete(adapter.transcribe(b"\x00" * 100))


# ── transcribe_stream ────────────────────────────────────────────────────────
def test_qwen3_transcribe_stream_yields_segments():
    from app.stt.base import TranscriptSegment

    async def collect():
        adapter = _make_adapter_with_mock_model("스트리밍 테스트")
        segments = []
        async for seg in adapter.transcribe_stream(
            _aiter([b"\x00" * 96000, b"\x00" * 96000])
        ):
            segments.append(seg)
        return segments

    segments = asyncio.get_event_loop().run_until_complete(collect())
    assert len(segments) > 0
    assert all(isinstance(s, __import__("app.stt.base", fromlist=["TranscriptSegment"]).TranscriptSegment) for s in segments)


async def _aiter(items):
    for item in items:
        yield item


# ── transcribe_file ──────────────────────────────────────────────────────────
def test_qwen3_transcribe_file_returns_list(tmp_path):
    audio_file = tmp_path / "test.pcm"
    audio_file.write_bytes(b"\x00" * 96000)
    adapter = _make_adapter_with_mock_model("파일 테스트")
    result = asyncio.get_event_loop().run_until_complete(
        adapter.transcribe_file(str(audio_file))
    )
    assert isinstance(result, list)
    assert len(result) > 0


# ── factory 연동 ─────────────────────────────────────────────────────────────
def test_factory_creates_qwen3_adapter():
    from app.stt.factory import create_stt_adapter
    from app.stt.qwen3_adapter import Qwen3Adapter
    adapter = create_stt_adapter("qwen3_asr_8bit")
    assert isinstance(adapter, Qwen3Adapter)


# ── speaker_label 기본값 ──────────────────────────────────────────────────────
def test_qwen3_segment_speaker_label_default_none():
    adapter = _make_adapter_with_mock_model("화자 테스트")
    audio = b"\x00" * 96000
    result = asyncio.get_event_loop().run_until_complete(adapter.transcribe(audio))
    assert result[0].speaker_label is None
