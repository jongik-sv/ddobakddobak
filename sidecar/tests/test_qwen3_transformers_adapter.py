"""Qwen3TransformersAdapter(CUDA 경로) — context-biasing seam 테스트.

qwen-asr의 transcribe(context=...)는 context 문자열을 system 메시지로 주입해
인식을 바이어스한다(도메인 용어·참석자명 → 한국어 고유명사 정확도↑).
어댑터가 self._context를 model.transcribe로 올바로 전달하는지 검증한다.
model을 mock 주입하므로 CUDA/qwen-asr 없이 동작한다.
"""
import asyncio
from unittest.mock import MagicMock


def _make_adapter_with_mock_model(text: str = "안녕하세요 회의를 시작하겠습니다"):
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    adapter = Qwen3TransformersAdapter()
    mock_model = MagicMock()
    seg = MagicMock()
    seg.text = text
    seg.language = "ko"
    mock_model.transcribe.return_value = [seg]
    adapter._model = mock_model
    adapter._is_loaded = True
    return adapter


def test_context_defaults_to_empty_string():
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    assert Qwen3TransformersAdapter()._context == ""


def test_context_via_constructor():
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    assert Qwen3TransformersAdapter(context="또박또박, 사이드카")._context == "또박또박, 사이드카"


def test_set_context_updates_and_none_resets():
    from app.stt.qwen3_transformers_adapter import Qwen3TransformersAdapter
    a = Qwen3TransformersAdapter()
    a.set_context("또박또박, 화자분리, KsponSpeech")
    assert a._context == "또박또박, 화자분리, KsponSpeech"
    a.set_context(None)
    assert a._context == ""


def test_context_forwarded_to_model_transcribe():
    adapter = _make_adapter_with_mock_model()
    adapter.set_context("또박또박, 사이드카, 뤼튼")
    audio = b"\x00" * 96000  # 3초 PCM 16kHz 16bit
    asyncio.get_event_loop().run_until_complete(
        adapter.transcribe(audio, languages=["ko"], mode="single")
    )
    kwargs = adapter._model.transcribe.call_args.kwargs
    assert kwargs.get("context") == "또박또박, 사이드카, 뤼튼"


def test_empty_context_forwarded_as_empty_string():
    adapter = _make_adapter_with_mock_model()
    audio = b"\x00" * 96000
    asyncio.get_event_loop().run_until_complete(
        adapter.transcribe(audio, languages=["ko"], mode="single")
    )
    assert adapter._model.transcribe.call_args.kwargs.get("context") == ""
