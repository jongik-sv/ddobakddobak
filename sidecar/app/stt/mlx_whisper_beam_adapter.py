"""MLXWhisperBeamAdapter: vendored Lightning-SimulWhisper 기반 beam search Whisper STT.

MLX whisper(large-v3-turbo)를 **beam search 디코더**로 실행하는 배치(파일 재전사) 전용 엔진.
mlx-audio/mlx_whisper greedy 경로는 애매한 발음에서 환각("LPR"→"랩", gibberish)을 내는데,
beam search가 이 정확도 갭을 메운다. 트레이드오프: greedy 대비 ~3.5× 느림(10분 104s vs 29s)이나
절대 5.75× 실시간 + 환각 제거. 셀렉터로 사용자가 선택(기본은 8bit greedy 유지).

vendored 모듈: app/stt/vendor/lw_whisper/ (Lightning-SimulWhisper simul_whisper/mlx_whisper).
그 안 decoding.BeamSearchDecoder가 진짜 beam을 제공한다(mlx-community/mlx_whisper에는 없음).

MLXWhisperAdapter와 동일한 입출력 계약(PCM bytes → list[TranscriptSegment])을 따른다.
"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

import numpy as np

from app.stt import lang_utils
from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment
from app.stt.mlx_whisper_adapter import _collapse_repetition, _seg_confidence

# beam은 full(비양자화) turbo repo에서 검증됨. 8bit/fp16 양자화 repo와 별개로 1회 다운(~1.6GB).
_REPO = "mlx-community/whisper-large-v3-turbo"
_MODEL_NAME = "large-v3-turbo"
_BEAM_SIZE = 5
_SAMPLE_RATE = 16000


class MLXWhisperBeamAdapter(SttAdapter):
    """vendored Lightning MLX whisper + BeamSearchDecoder 기반 STT Adapter.

    - transcribe()가 ModelHolder로 모델을 모듈 캐시(첫 호출만 로드)
    - beam_size=5, temperature=0.0 고정 → fallback 비활성, beam 유지
      (temperature>0 fallback 시 vendored transcribe가 beam_size를 drop함, decoding 경로상)
    """

    def __init__(self, model_id: str = _REPO):
        super().__init__()
        self._model_id = model_id
        self._transcribe = None

    async def load_model(self) -> None:
        """vendored transcribe 함수 바인딩 + 모델 가중치 워밍(ModelHolder 캐시)."""
        try:
            from app.stt.vendor.lw_whisper.transcribe import ModelHolder, transcribe
        except ImportError as e:
            raise ImportError(
                "vendored lw_whisper 모듈을 불러오지 못했습니다. "
                "app/stt/vendor/lw_whisper/ 및 tiktoken/more-itertools 설치를 확인하세요."
            ) from e

        import mlx.core as mx

        loop = asyncio.get_running_loop()
        # 가중치를 미리 받아 ModelHolder에 캐시(첫 transcribe 호출 지연 제거)
        await loop.run_in_executor(
            None,
            lambda: ModelHolder.get_model(self._model_id, mx.float16, _MODEL_NAME),
        )
        self._transcribe = transcribe
        self._is_loaded = True

    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 beam search로 전사한다(MLXWhisperAdapter와 동일 계약).

        single 모드: languages[0]을 ISO 코드로 인식 언어 강제.
        multi 모드: 자동감지(language=None) 후 result["language"]를 세그먼트에 기록.
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        engine_lang = lang_utils.iso_force_lang(languages, mode)  # ISO or None
        raw_segments, detected = await self._run_inference(audio_array, engine_lang)

        seg_lang = (
            lang_utils.normalize_to_iso(detected)
            if mode == "multi"
            else (languages[0] if languages else "ko")
        ) or "ko"

        results: list[TranscriptSegment] = []
        for seg in raw_segments:
            text = _collapse_repetition((seg.get("text") or "").strip())
            if not text or is_hallucination(text, languages):
                continue
            results.append(TranscriptSegment(
                text=text,
                started_at_ms=int(float(seg.get("start", 0.0)) * 1000),
                ended_at_ms=int(float(seg.get("end", 0.0)) * 1000),
                language=seg_lang,
                confidence=_seg_confidence(seg),
            ))
        return results

    async def _run_inference(
        self, audio_array: np.ndarray, language: str | None
    ) -> tuple[list[dict], str | None]:
        """vendored beam transcribe 실행. (segments, 감지언어) 반환."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, language)

    def _infer(self, audio_array: np.ndarray, language: str | None) -> tuple[list[dict], str | None]:
        """동기 beam search 추론. vendored transcribe dict(segments/language) 반환."""
        result = self._transcribe(
            audio_array,
            path_or_hf_repo=self._model_id,
            model_name=_MODEL_NAME,
            language=language,
            beam_size=_BEAM_SIZE,
            temperature=0.0,
            word_timestamps=False,
            verbose=False,
        )
        segments = result.get("segments") or []
        detected = result.get("language")
        return segments, detected

    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """오디오 스트림을 청크 단위로 순차 변환한다."""
        async for chunk in audio_stream:
            segments = await self.transcribe(chunk)
            for seg in segments:
                yield seg
