"""WhisperAdapter: pywhispercpp 기반 whisper.cpp STT Adapter."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import AsyncIterator

from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment

_MODEL_NAME = "large-v3-turbo"
# 모델 캐시 위치: 환경변수 WHISPER_MODELS_DIR 우선, 없으면 사전 다운로드된 사용자 프로필 경로 사용.
# (서비스가 SYSTEM 계정으로 실행될 경우 기본 캐시 경로가 systemprofile로 잡혀 다운로드가 실패하므로 명시 지정)
_DEFAULT_MODELS_DIR = Path(r"C:\Users\USER\AppData\Local\pywhispercpp\pywhispercpp\models")
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # Int16
# pywhispercpp 타임스탬프 단위: 10ms
_TIMESTAMP_UNIT_MS = 10


class WhisperAdapter(SttAdapter):
    """whisper.cpp (large-v3-turbo) 기반 STT Adapter.

    pywhispercpp Python 바인딩을 사용하며,
    Apple Silicon Metal/ANE 가속이 자동으로 적용된다.
    """

    def __init__(self, model_name: str = _MODEL_NAME):
        super().__init__()
        self._model_name = model_name
        self._model = None

    async def load_model(self) -> None:
        """pywhispercpp 모델을 로드한다 (다국어 모드)."""
        try:
            from pywhispercpp.model import Model  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "pywhispercpp이 설치되어 있지 않습니다. "
                "'uv add pywhispercpp'으로 설치 후 재시작하세요."
            ) from e

        loop = asyncio.get_running_loop()
        from pywhispercpp.model import Model

        models_dir = os.environ.get("WHISPER_MODELS_DIR") or str(_DEFAULT_MODELS_DIR)
        self._model = await loop.run_in_executor(
            None,
            lambda: Model(self._model_name, models_dir=models_dir),
        )
        self._is_loaded = True

    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        Args:
            audio_chunk: PCM 16kHz mono Int16 바이너리
            languages: 인식 대상 언어 코드 목록. 단일 언어면 해당 언어로 고정, 다국어면 자동 감지.

        Returns:
            TranscriptSegment 리스트
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        # 단일 언어면 해당 언어로 고정, 다국어면 자동 감지
        language = languages[0] if languages and len(languages) == 1 else None
        audio_array = pcm_bytes_to_float32(audio_chunk)
        raw_segments = await self._run_inference(audio_array, language=language)
        return [
            _to_transcript_segment(seg, language=language)
            for seg in raw_segments
            if seg.text.strip() and not is_hallucination(seg.text, languages)
        ]

    async def _run_inference(self, audio_array, language: str | None = None) -> list:
        """pywhispercpp 추론 실행 (blocking → executor 비동기화)."""
        loop = asyncio.get_running_loop()
        lang = language or "auto"
        return await loop.run_in_executor(
            None,
            lambda: self._model.transcribe(audio_array, language=lang),
        )

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



def _to_transcript_segment(raw_seg, language: str | None = None) -> TranscriptSegment:
    """pywhispercpp Segment → TranscriptSegment 변환.

    pywhispercpp의 타임스탬프는 10ms 단위이므로 ms로 변환한다.
    """
    started_at_ms = getattr(raw_seg, "t0", 0) * _TIMESTAMP_UNIT_MS
    ended_at_ms = getattr(raw_seg, "t1", 0) * _TIMESTAMP_UNIT_MS
    return TranscriptSegment(
        text=raw_seg.text.strip(),
        started_at_ms=started_at_ms,
        ended_at_ms=ended_at_ms,
        language=language or "auto",
        confidence=0.85,
    )
