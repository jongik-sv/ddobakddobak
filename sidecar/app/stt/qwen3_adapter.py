"""Qwen3-ASR Adapter: mlx-audio 기반 Apple Silicon STT (vllm 대체)."""
from __future__ import annotations

import asyncio
import re
from typing import AsyncIterator

import numpy as np

from app.stt.base import SttAdapter, TranscriptSegment

_MODEL_ID = "mlx-community/Qwen3-ASR-1.7B-4bit"
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # Int16

# 환각 판별용 상수
_MIN_MEANINGFUL_CHARS = 3
_PUNCT_RE = re.compile(r'[\s\.,!?~\-\'"()]')

# 언어별 문자 범위 (환각 판별용)
_LANG_CHAR_RANGES = {
    "ko": (0xAC00, 0xD7A3),  # 한글 음절
    "ja": (0x3040, 0x30FF),  # 히라가나 + 카타카나
    "zh": (0x4E00, 0x9FFF),  # CJK 통합 한자
    "en": (0x0041, 0x007A),  # ASCII 영문자
}


def _is_hallucination(text: str, languages: list[str] | None = None) -> bool:
    """짧은 환각성 텍스트 여부 판별."""
    stripped = _PUNCT_RE.sub("", text.strip())
    if not stripped:
        return True
    target_langs = languages or ["ko"]
    lang_chars = 0
    for lang in target_langs:
        char_range = _LANG_CHAR_RANGES.get(lang)
        if char_range:
            lo, hi = char_range
            lang_chars += sum(1 for c in stripped if lo <= ord(c) <= hi)
    # 대상 언어 문자가 있지만 최소 수 미만이면 환각
    if 0 < lang_chars < _MIN_MEANINGFUL_CHARS:
        return True
    return False


class Qwen3Adapter(SttAdapter):
    """Qwen3-ASR-1.7B mlx-audio 기반 STT Adapter (Apple Silicon 전용).

    mlx-audio를 사용하여 Apple Silicon GPU(Metal)에서 실행된다.
    """

    def __init__(self, model_id: str = _MODEL_ID):
        super().__init__()
        self._model_id = model_id
        self._model = None

    async def load_model(self) -> None:
        """mlx-audio로 Qwen3-ASR 모델을 로드한다."""
        try:
            from mlx_audio.stt.utils import load_model as mlx_load
        except ImportError as e:
            raise ImportError(
                "mlx-audio가 설치되어 있지 않습니다. "
                "'uv add mlx-audio'로 설치 후 재시작하세요."
            ) from e

        loop = asyncio.get_running_loop()
        self._model = await loop.run_in_executor(
            None,
            lambda: mlx_load(self._model_id),
        )
        self._is_loaded = True

    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        Args:
            audio_chunk: PCM 16kHz mono Int16 바이너리
            languages: 인식 대상 언어 코드 목록 (Qwen3는 자동 감지)

        Returns:
            TranscriptSegment 리스트
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = _pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        chunk_duration_ms = int(len(audio_array) / _SAMPLE_RATE * 1000)

        lang = (languages[0] if languages else "ko")
        text = await self._run_inference(audio_array, lang)
        if not text or not text.strip() or _is_hallucination(text, languages):
            return []

        return [
            TranscriptSegment(
                text=text.strip(),
                started_at_ms=0,
                ended_at_ms=max(chunk_duration_ms, 1000),
                language=lang,
                confidence=0.9,
            )
        ]

    async def _run_inference(self, audio_array: np.ndarray, language: str = "ko") -> str:
        """mlx-audio 추론 실행 (blocking → executor 비동기화)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, language)

    def _infer(self, audio_array: np.ndarray, language: str = "ko") -> str:
        """동기 mlx-audio 추론."""
        result = self._model.generate(audio_array, language=language)
        return result.text if hasattr(result, "text") else str(result)

    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """오디오 스트림을 청크 단위로 순차 변환한다."""
        async for chunk in audio_stream:
            segments = await self.transcribe(chunk)
            for seg in segments:
                yield seg

    async def transcribe_file(self, file_path: str) -> list[TranscriptSegment]:
        """오디오 파일 전체를 변환한다."""
        with open(file_path, "rb") as f:
            audio_bytes = f.read()
        return await self.transcribe(audio_bytes)


def _pcm_bytes_to_float32(audio_bytes: bytes) -> np.ndarray:
    """PCM Int16 bytes를 float32 numpy 배열로 변환한다."""
    return np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
