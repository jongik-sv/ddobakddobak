"""FasterWhisperAdapter: faster-whisper (CTranslate2) 기반 STT Adapter.

NVIDIA GPU(CUDA) 환경에서 최적 성능을 발휘한다.
CPU에서도 동작하지만, GPU 없는 환경에서는 whisper.cpp가 더 효율적이다.
"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

from app.stt import lang_utils
from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment
from app.stt.idle_offload import IdleOffloadController, ResidentState

_MODEL_SIZE = "large-v3-turbo"
_SAMPLE_RATE = 16000


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

        # GPU 유휴 오프로드 — CTranslate2는 PyTorch처럼 .to('cpu')로 GPU<->CPU를 오갈 수
        # 없으므로 1단계에서 바로 모델 객체를 완전히 해제한다(2단계 개념 없음, stage2 콜백 없음).
        # device="cpu"(faster_whisper_cpu 엔진)는 애초에 GPU를 쓰지 않으므로 오프로드는 no-op.
        supports_offload = self._device != "cpu"
        self._idle = IdleOffloadController(
            name=f"faster_whisper({self._model_size},device={self._device})",
            stage1_offload=self._offload_full if supports_offload else None,
            stage1_target=ResidentState.UNLOADED,
            reload_from_unloaded=self._reload_full if supports_offload else None,
        )

    def _load_sync(self):
        from faster_whisper import WhisperModel
        return WhisperModel(
            self._model_size,
            device=self._device,
            compute_type="auto" if self._device != "cpu" else "int8",
        )

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
        self._model = await loop.run_in_executor(None, self._load_sync)
        self._is_loaded = True
        self._idle.mark_loaded()

    # ── GPU 유휴 오프로드 콜백 ───────────────────────────────────────────
    # CTranslate2 모델은 CPU 상주 중간 상태 없이 del + 재로드만 지원한다(1단계 = 완전 해제).

    async def _offload_full(self) -> None:
        loop = asyncio.get_running_loop()

        def _unload():
            import gc
            self._model = None
            gc.collect()

        await loop.run_in_executor(None, _unload)

    async def _reload_full(self) -> None:
        loop = asyncio.get_running_loop()
        self._model = await loop.run_in_executor(None, self._load_sync)

    @property
    def gpu_resident(self) -> bool:
        return self._idle.gpu_resident

    @property
    def resident_state(self) -> str:
        return self._idle.state.value

    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        await self._idle.maybe_offload(idle_unload_sec, idle_full_unload_sec)

    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        single 모드: languages[0]을 ISO 코드로 인식 언어 강제.
        multi 모드: 자동감지 후 info.language를 세그먼트에 기록(필터는 main에서).
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        async with self._idle:
            raw_segments = await self._run_inference(audio_array, languages=languages, mode=mode)
        return [
            seg for seg in raw_segments
            if seg.text.strip() and not is_hallucination(seg.text, languages)
        ]

    async def _run_inference(self, audio_array, languages, mode) -> list[TranscriptSegment]:
        """faster-whisper 추론 실행 (blocking → executor 비동기화)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, languages, mode)

    def _infer(self, audio_array, languages, mode) -> list[TranscriptSegment]:
        """동기 faster-whisper 추론."""
        engine_lang = lang_utils.iso_force_lang(languages, mode)  # ISO or None
        segments_iter, info = self._model.transcribe(
            audio_array,
            language=engine_lang,
            vad_filter=True,
        )
        detected = getattr(info, "language", None)
        results = []
        for seg in segments_iter:
            seg_lang = detected if mode == "multi" else (languages[0] if languages else "ko")
            results.append(TranscriptSegment(
                text=seg.text.strip(),
                started_at_ms=int(seg.start * 1000),
                ended_at_ms=int(seg.end * 1000),
                language=seg_lang or "ko",
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
                if text and not is_hallucination(text, languages):
                    results.append(TranscriptSegment(
                        text=text,
                        started_at_ms=int(seg.start * 1000),
                        ended_at_ms=int(seg.end * 1000),
                        language=language or "auto",
                        confidence=seg.avg_logprob if seg.avg_logprob else 0.0,
                    ))
            return results

        async with self._idle:
            return await loop.run_in_executor(None, _transcribe)


