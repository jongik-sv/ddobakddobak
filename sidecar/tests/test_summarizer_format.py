"""_format_transcripts 발화 시각(ms) 노출 테스트."""
from app.llm.summarizer import LLMSummarizer


def test_format_transcripts_exposes_ms():
    s = LLMSummarizer.__new__(LLMSummarizer)  # __init__ 의존 회피
    out = s._format_transcripts([{"speaker": "화자 1", "text": "결정 보류", "started_at_ms": 125000}])
    assert out == "[02:05|125000ms 화자 1] 결정 보류"
