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

from app.stt import lang_utils
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

    def __init__(
        self,
        model_id: str = _MODEL_ID,
        quantization: str | None = None,
        context: str = "",
        backend: str = "transformers",
        gpu_memory_utilization: float = 0.3,
    ):
        super().__init__()
        self._model_id = model_id
        self._quantization = quantization  # None(=full BF16), "6bit"(nf4 4-bit), "8bit"
        # context-biasing: qwen-asr가 이 문자열을 system 메시지로 주입해 인식을 바이어스한다.
        # 회의 참석자명·안건·도메인 용어를 넣으면 한국어 고유명사 인식이 크게 개선된다.
        # 기본 ""(비활성) — set_context()로 회의별 주입.
        self._context = context or ""
        # 백엔드: "transformers"(기본, HF 순정 로드) | "vllm"(vLLM 서빙, 고속·대신 GPU 메모리 선점)
        self._backend = backend
        # vLLM 전용: 프로세스가 점유할 GPU 메모리 비율. diarization·임베딩 등과 GPU를 공유하므로
        # vLLM 기본값(0.9)이 아닌 보수적인 0.3으로 낮춰 잡는다. transformers 백엔드에선 미사용.
        self._gpu_memory_utilization = gpu_memory_utilization
        if self._backend == "vllm" and self._quantization is not None:
            # bitsandbytes 양자화는 transformers 전용 경로(BitsAndBytesConfig)에서만 지원된다.
            raise ValueError(
                "vllm 백엔드는 quantization을 지원하지 않습니다 (bitsandbytes는 transformers 전용)."
            )
        self._model = None

    def set_context(self, context: str | None) -> None:
        """인식 바이어스용 context(도메인 용어·참석자명 등)를 설정한다. None/빈값이면 비활성."""
        self._context = context or ""

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
                "Qwen3-ASR%s [backend=%s]: CUDA GPU 감지됨 — GPU 모드로 로드합니다. (device=%s)",
                quant_label, self._backend, torch.cuda.get_device_name(0),
            )

            if self._backend == "vllm":
                # vLLM은 프로세스 시작 시 GPU 메모리를 선점(reserve)한다. diarization·임베딩 등
                # 다른 모델과 같은 GPU를 공유해야 하므로 vLLM 기본값(0.9)보다 훨씬 낮은 비율을 쓴다.
                model = Qwen3ASRModel.LLM(
                    self._model_id,
                    gpu_memory_utilization=self._gpu_memory_utilization,
                    max_new_tokens=448,
                )
                return model

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
                    bnb_4bit_compute_dtype=torch.bfloat16,
                )
            elif self._quantization == "8bit":
                from transformers import BitsAndBytesConfig
                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_8bit=True,
                )
            else:
                # Qwen3-ASR 가중치는 BF16 네이티브 → BF16으로 로드해야 다운캐스트(fp16 range 손실)
                # 없이 한국어 정확도가 최대. RTX 5000 Ada는 BF16 텐서코어 네이티브 지원.
                kwargs["dtype"] = torch.bfloat16

            model = Qwen3ASRModel.from_pretrained(self._model_id, **kwargs)
            return model

        self._model = await loop.run_in_executor(None, _load)
        self._is_loaded = True
        logger.info("Qwen3-ASR 모델 로드 완료 (model=%s)", self._model_id)

    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single") -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다."""
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        chunk_duration_ms = int(len(audio_array) / _SAMPLE_RATE * 1000)

        engine_lang = lang_utils.qwen_force_lang(languages, mode)
        loop = asyncio.get_running_loop()
        segments = await loop.run_in_executor(None, self._infer_from_pcm, audio_array, engine_lang, languages, mode, chunk_duration_ms)
        return segments

    def _infer_from_pcm(
        self,
        audio_array: np.ndarray,
        engine_lang: str | None,
        languages: list[str] | None,
        mode: str,
        chunk_duration_ms: int,
    ) -> list[TranscriptSegment]:
        """PCM float32 -> 임시 wav -> qwen-asr transcribe."""
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio_array, _SAMPLE_RATE)
            results = self._model.transcribe(audio=tmp.name, context=self._context, language=engine_lang)

        segments = []
        for r in results:
            text = r.text.strip()
            if not text or is_hallucination(text, languages):
                continue
            seg_lang = (
                lang_utils.normalize_to_iso(r.language)
                if mode == "multi"
                else (languages[0] if languages else "ko")
            )
            segments.append(TranscriptSegment(
                text=text,
                started_at_ms=0,
                ended_at_ms=max(chunk_duration_ms, 1000),
                language=seg_lang,
                confidence=0.9,
            ))
        return segments

    async def transcribe_stream(
        self, audio_stream, languages: list[str] | None = None, mode: str = "single"
    ) -> AsyncIterator[TranscriptSegment]:
        """오디오 스트림을 청크 단위로 순차 변환한다."""
        async for chunk in audio_stream:
            segments = await self.transcribe(chunk, languages=languages, mode=mode)
            for seg in segments:
                yield seg

    async def transcribe_file(self, file_path: str, languages: list[str] | None = None, mode: str = "single") -> list[TranscriptSegment]:
        """오디오 파일 전체를 변환한다."""
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        engine_lang = lang_utils.qwen_force_lang(languages, mode)
        loop = asyncio.get_running_loop()

        def _transcribe() -> list[TranscriptSegment]:
            if file_path.endswith((".pcm", ".raw")):
                # raw PCM은 임시 wav로 변환
                return self._transcribe_pcm_file(file_path, languages=languages, mode=mode)

            results = self._model.transcribe(audio=file_path, context=self._context, language=engine_lang)
            segments = []
            for r in results:
                text = r.text.strip()
                if text and not is_hallucination(text, languages):
                    seg_lang = (
                        lang_utils.normalize_to_iso(r.language)
                        if mode == "multi"
                        else (languages[0] if languages else (r.language or "ko"))
                    )
                    segments.append(TranscriptSegment(
                        text=text,
                        started_at_ms=0,
                        ended_at_ms=0,
                        language=seg_lang,
                        confidence=0.9,
                    ))
            return segments

        return await loop.run_in_executor(None, _transcribe)

    def _transcribe_pcm_file(self, file_path: str, languages: list[str] | None = None, mode: str = "single") -> list[TranscriptSegment]:
        """raw PCM 파일을 wav로 변환 후 추론."""
        import soundfile as sf

        with open(file_path, "rb") as f:
            audio_array = pcm_bytes_to_float32(f.read())

        engine_lang = lang_utils.qwen_force_lang(languages, mode)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio_array, _SAMPLE_RATE)
            results = self._model.transcribe(audio=tmp.name, context=self._context, language=engine_lang)

        segments = []
        for r in results:
            text = r.text.strip()
            if text and not is_hallucination(text, languages):
                seg_lang = (
                    lang_utils.normalize_to_iso(r.language)
                    if mode == "multi"
                    else (languages[0] if languages else (r.language or "ko"))
                )
                segments.append(TranscriptSegment(
                    text=text,
                    started_at_ms=0,
                    ended_at_ms=int(len(audio_array) / _SAMPLE_RATE * 1000),
                    language=seg_lang,
                    confidence=0.9,
                ))
        return segments
