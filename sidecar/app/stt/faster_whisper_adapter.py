"""FasterWhisperAdapter: faster-whisper (CTranslate2) 기반 STT Adapter.

NVIDIA GPU(CUDA) 환경에서 최적 성능을 발휘한다.
CPU에서도 동작하지만, GPU 없는 환경에서는 whisper.cpp가 더 효율적이다.
"""
from __future__ import annotations

import asyncio
import re
from typing import AsyncIterator

from app.stt.base import SttAdapter, TranscriptSegment

_MODEL_SIZE = "large-v3-turbo"
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # Int16

# 의미 있는 최소 글자 수 — 이보다 짧으면 환각으로 간주
_MIN_MEANINGFUL_CHARS = 3
_PUNCT_RE = re.compile(r'[\s\.,!?~\-\'"()]')

# 언어별 문자 범위 (환각 판별용)
_LANG_CHAR_RANGES = {
    "ko": (0xAC00, 0xD7A3),
    "ja": (0x3040, 0x30FF),
    "zh": (0x4E00, 0x9FFF),
}


def _is_hallucination(text: str, languages: list[str] | None = None) -> bool:
    """짧은 환각성 텍스트 여부 판별."""
    stripped = _PUNCT_RE.sub('', text.strip())
    if not stripped:
        return True
    target_langs = languages or ["ko"]
    lang_chars = 0
    for lang in target_langs:
        char_range = _LANG_CHAR_RANGES.get(lang)
        if char_range:
            lo, hi = char_range
            lang_chars += sum(1 for c in stripped if lo <= ord(c) <= hi)
    if 0 < lang_chars < _MIN_MEANINGFUL_CHARS:
        return True
    return False


class FasterWhisperAdapter(SttAdapter):
    """faster-whisper (CTranslate2) 기반 STT Adapter.

    - NVIDIA CUDA GPU 자동 감지 (device="auto")
    - Silero VAD 내장으로 무음 구간 자동 스킵
    - CPU 폴백 지원
    """

    def __init__(self, model_size: str = _MODEL_SIZE, device: str = "auto"):
        super().__init__()
        self._model_size = model_size
        self._device = device
        self._model = None

    async def load_model(self) -> None:
        """faster-whisper 모델을 로드한다."""
        try:
            from faster_whisper import WhisperModel  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "faster-whisper가 설치되어 있지 않습니다. "
                "'uv sync --extra cuda'로 설치 후 재시작하세요."
            ) from e

        loop = asyncio.get_running_loop()

        def _load():
            from faster_whisper import WhisperModel
            return WhisperModel(
                self._model_size,
                device=self._device,
                compute_type="auto" if self._device != "cpu" else "int8",
            )

        self._model = await loop.run_in_executor(None, _load)
        self._is_loaded = True

    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다."""
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = _pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        raw_segments = await self._run_inference(audio_array, languages=languages)
        return [
            seg for seg in raw_segments
            if seg.text.strip() and not _is_hallucination(seg.text, languages)
        ]

    async def _run_inference(self, audio_array, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """faster-whisper 추론 실행 (blocking → executor 비동기화)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, languages)

    def _infer(self, audio_array, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """동기 faster-whisper 추론."""
        language = languages[0] if languages and len(languages) == 1 else None
        segments_iter, _info = self._model.transcribe(
            audio_array,
            language=language,
            vad_filter=True,
        )
        results = []
        for seg in segments_iter:
            results.append(TranscriptSegment(
                text=seg.text.strip(),
                started_at_ms=int(seg.start * 1000),
                ended_at_ms=int(seg.end * 1000),
                language=language or "auto",
                confidence=seg.avg_logprob if seg.avg_logprob else 0.0,
            ))
        return results

    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """오디오 스트림을 청크 단위로 순차 변환한다."""
        async for chunk in audio_stream:
            segments = await self.transcribe(chunk)
            for seg in segments:
                yield seg

    async def transcribe_file(self, file_path: str, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """오디오 파일 전체를 변환한다.

        faster-whisper는 파일 경로를 직접 받을 수 있어 메모리 효율적이다.
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        loop = asyncio.get_running_loop()
        language = languages[0] if languages and len(languages) == 1 else None

        def _transcribe():
            segments_iter, _info = self._model.transcribe(
                file_path,
                language=language,
                vad_filter=True,
            )
            results = []
            for seg in segments_iter:
                text = seg.text.strip()
                if text and not _is_hallucination(text, languages):
                    results.append(TranscriptSegment(
                        text=text,
                        started_at_ms=int(seg.start * 1000),
                        ended_at_ms=int(seg.end * 1000),
                        language=language or "auto",
                        confidence=seg.avg_logprob if seg.avg_logprob else 0.0,
                    ))
            return results

        return await loop.run_in_executor(None, _transcribe)


def _pcm_bytes_to_float32(audio_bytes: bytes):
    """PCM Int16 bytes를 float32 numpy 배열로 변환한다."""
    import numpy as np
    return np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
