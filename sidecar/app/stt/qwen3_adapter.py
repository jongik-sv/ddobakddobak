"""Qwen3-ASR Adapter: mlx-audio 기반 Apple Silicon STT (vllm 대체)."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

import numpy as np

from app.stt import lang_utils
from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment

_MODEL_ID = "mlx-community/Qwen3-ASR-1.7B-4bit"
_SAMPLE_RATE = 16000


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

    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        single 모드: languages[0]을 Qwen 풀네임으로 변환하여 인식 언어 강제.
        multi 모드: 자동감지(language=None) 후 감지언어를 세그먼트에 기록(필터는 main에서).
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        chunk_duration_ms = int(len(audio_array) / _SAMPLE_RATE * 1000)
        engine_lang = lang_utils.qwen_force_lang(languages, mode)  # 풀네임 or None
        # single 모드인데 languages가 비어 있으면 한국어로 강제(안전 기본값).
        # 자동감지로 두면 엉뚱한 언어로 환각할 수 있어 주 사용 언어인 한국어를 우선한다.
        if mode == "single" and engine_lang is None:
            engine_lang = "Korean"

        text, detected = await self._run_inference(audio_array, engine_lang)
        if not text or not text.strip() or is_hallucination(text, languages):
            return []

        # single이면 강제 언어(ISO), multi면 감지언어(ISO 정규화)
        seg_lang = (
            lang_utils.normalize_to_iso(detected)
            if mode == "multi"
            else (languages[0] if languages else "ko")
        )

        return [
            TranscriptSegment(
                text=text.strip(),
                started_at_ms=0,
                ended_at_ms=max(chunk_duration_ms, 1000),
                language=seg_lang,
                confidence=0.9,
            )
        ]

    async def _run_inference(self, audio_array: np.ndarray, language: str | None) -> tuple[str, str | None]:
        """mlx-audio 추론 실행. (text, 감지언어) 반환."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, language)

    def _infer(self, audio_array: np.ndarray, language: str | None) -> tuple[str, str | None]:
        """동기 mlx-audio 추론. result.language(리스트/문자열)에서 감지언어 추출."""
        result = self._model.generate(audio_array, language=language)
        text = result.text if hasattr(result, "text") else str(result)
        detected = None
        lang_attr = getattr(result, "language", None)
        if isinstance(lang_attr, list) and lang_attr:
            detected = lang_attr[0]
        elif isinstance(lang_attr, str):
            detected = lang_attr
        return text, detected

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


