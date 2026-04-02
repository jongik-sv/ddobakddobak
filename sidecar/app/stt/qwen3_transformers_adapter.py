"""Qwen3TransformersAdapter: qwen-asr 공식 패키지 기반 STT Adapter.

Windows/Linux에서 NVIDIA CUDA GPU로 Qwen3-ASR-1.7B를 실행한다.
GPU가 없는 환경에서는 faster_whisper(CPU 폴백)를 사용해야 한다.
Apple Silicon 환경에서는 mlx-audio 기반 qwen3_adapter.py를 사용한다.
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from typing import AsyncIterator

import numpy as np

from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment

logger = logging.getLogger(__name__)

_MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
_SAMPLE_RATE = 16000


class Qwen3TransformersAdapter(SttAdapter):
    """Qwen3-ASR-1.7B qwen-asr 공식 패키지 기반 STT Adapter.

    - NVIDIA CUDA GPU 필수 (GPU 없으면 RuntimeError)
    - qwen_asr.Qwen3ASRModel 사용
    - PCM 16kHz mono Int16 입력 처리
    """

    def __init__(self, model_id: str = _MODEL_ID, quantization: str | None = None):
        super().__init__()
        self._model_id = model_id
        self._quantization = quantization  # None, "4bit", "8bit"
        self._model = None

    async def load_model(self) -> None:
        """qwen-asr 패키지로 Qwen3-ASR 모델을 로드한다."""
        try:
            from qwen_asr import Qwen3ASRModel  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "qwen-asr 패키지가 설치되어 있지 않습니다. "
                "'pip install qwen-asr'로 설치 후 재시작하세요."
            ) from e

        try:
            import torch  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "torch가 설치되어 있지 않습니다. "
                "CUDA 버전의 PyTorch를 설치해주세요."
            ) from e

        loop = asyncio.get_running_loop()

        def _load():
            import torch
            from qwen_asr import Qwen3ASRModel

            if not torch.cuda.is_available():
                raise RuntimeError(
                    "Qwen3-ASR 엔진은 NVIDIA CUDA GPU가 필요합니다. "
                    "GPU가 없는 환경에서는 'faster_whisper' 엔진을 사용하세요."
                )

            quant_label = f" ({self._quantization})" if self._quantization else ""
            logger.info(
                "Qwen3-ASR%s: CUDA GPU 감지됨 — GPU 모드로 로드합니다. (device=%s)",
                quant_label, torch.cuda.get_device_name(0),
            )

            kwargs: dict = {
                "device_map": "cuda:0",
                "max_new_tokens": 448,
            }

            if self._quantization == "6bit":
                from transformers import BitsAndBytesConfig
                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_compute_dtype=torch.float16,
                )
            elif self._quantization == "8bit":
                from transformers import BitsAndBytesConfig
                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_8bit=True,
                )
            else:
                kwargs["dtype"] = torch.float16

            model = Qwen3ASRModel.from_pretrained(self._model_id, **kwargs)
            return model

        self._model = await loop.run_in_executor(None, _load)
        self._is_loaded = True
        logger.info("Qwen3-ASR 모델 로드 완료 (model=%s)", self._model_id)

    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다."""
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        chunk_duration_ms = int(len(audio_array) / _SAMPLE_RATE * 1000)

        text = await self._run_inference_from_pcm(audio_array)
        if not text or not text.strip() or is_hallucination(text):
            return []

        return [
            TranscriptSegment(
                text=text.strip(),
                started_at_ms=0,
                ended_at_ms=max(chunk_duration_ms, 1000),
                language="ko",
                confidence=0.9,
            )
        ]

    async def _run_inference_from_pcm(self, audio_array: np.ndarray) -> str:
        """PCM float32 배열을 임시 wav 파일로 저장 후 추론한다."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer_from_pcm, audio_array)

    def _infer_from_pcm(self, audio_array: np.ndarray) -> str:
        """PCM float32 -> 임시 wav -> qwen-asr transcribe."""
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio_array, _SAMPLE_RATE)
            results = self._model.transcribe(audio=tmp.name, language=None)

        if results and len(results) > 0:
            return results[0].text.strip()
        return ""

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
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        loop = asyncio.get_running_loop()

        def _transcribe() -> list[TranscriptSegment]:
            if file_path.endswith((".pcm", ".raw")):
                # raw PCM은 임시 wav로 변환
                return self._transcribe_pcm_file(file_path)

            results = self._model.transcribe(audio=file_path, language=None)
            segments = []
            for r in results:
                text = r.text.strip()
                if text and not is_hallucination(text):
                    segments.append(TranscriptSegment(
                        text=text,
                        started_at_ms=0,
                        ended_at_ms=0,
                        language=r.language or "ko",
                        confidence=0.9,
                    ))
            return segments

        return await loop.run_in_executor(None, _transcribe)

    def _transcribe_pcm_file(self, file_path: str) -> list[TranscriptSegment]:
        """raw PCM 파일을 wav로 변환 후 추론."""
        import soundfile as sf

        with open(file_path, "rb") as f:
            audio_array = pcm_bytes_to_float32(f.read())

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio_array, _SAMPLE_RATE)
            results = self._model.transcribe(audio=tmp.name, language=None)

        segments = []
        for r in results:
            text = r.text.strip()
            if text and not is_hallucination(text):
                segments.append(TranscriptSegment(
                    text=text,
                    started_at_ms=0,
                    ended_at_ms=int(len(audio_array) / _SAMPLE_RATE * 1000),
                    language=r.language or "ko",
                    confidence=0.9,
                ))
        return segments
