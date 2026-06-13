"""MLXWhisperAdapter: mlx-audio 기반 Whisper(large-v3-turbo) STT Adapter.

Apple Silicon(Metal)에서 mlx-audio로 Whisper를 실행한다.
배치(파일 재전사) 경로 가속용. 실시간 STT(Qwen3)와는 별개 엔진.

Qwen3Adapter와 달리 Whisper는 ISO 언어 코드를 그대로 받고,
generate() 결과의 segments(list[dict])에 구간 타임스탬프가 들어 있어 다중 세그먼트를 반환한다.
"""
from __future__ import annotations

import asyncio
import re
from typing import AsyncIterator

import numpy as np

from app.stt import lang_utils
from app.stt.audio_utils import is_hallucination, pcm_bytes_to_float32
from app.stt.base import SttAdapter, TranscriptSegment

_MODEL_ID = "mlx-community/whisper-large-v3-turbo-8bit"
_SAMPLE_RATE = 16000
# tiktoken 포맷 mlx 양자화 repo는 preprocessor_config.json이 없어 WhisperProcessor를
# 못 붙인다(_processor=None → generate "Processor not found"). 원본 HF turbo repo에서
# processor(전처리기, 가중치 아님)만 받아 주입해 generate()가 동작하게 한다.
_PROCESSOR_REPO = "openai/whisper-large-v3-turbo"


class MLXWhisperAdapter(SttAdapter):
    """mlx-audio Whisper 기반 STT Adapter (Apple Silicon 전용).

    - mlx_audio.stt.load_model로 mlx-community Whisper 모델 로드
    - generate()가 내부적으로 30초 윈도우로 전체 오디오를 처리하고
      segments(start/end 초, text)를 반환 → ms로 변환
    """

    def __init__(self, model_id: str = _MODEL_ID):
        super().__init__()
        self._model_id = model_id
        self._model = None

    async def load_model(self) -> None:
        """mlx-audio로 Whisper 모델을 로드한다."""
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
        # 양자화 repo에 processor가 없으면 원본 HF turbo repo에서 주입
        if getattr(self._model, "_processor", None) is None:
            await loop.run_in_executor(None, self._attach_processor)
        self._is_loaded = True

    def _attach_processor(self) -> None:
        """원본 HF Whisper repo에서 WhisperProcessor를 받아 모델에 주입한다."""
        from transformers import WhisperProcessor
        self._model._processor = WhisperProcessor.from_pretrained(_PROCESSOR_REPO)

    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        single 모드: languages[0]을 ISO 코드로 인식 언어 강제.
        multi 모드: 자동감지(language=None) 후 result.language를 세그먼트에 기록(필터는 main에서).
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
        """mlx-audio 추론 실행. (segments, 감지언어) 반환."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, language)

    def _infer(self, audio_array: np.ndarray, language: str | None) -> tuple[list[dict], str | None]:
        """동기 mlx-audio Whisper 추론. STTOutput.segments(list[dict]) + language 반환."""
        result = self._model.generate(
            audio_array,
            language=language,
            word_timestamps=False,
            verbose=None,
        )
        segments = getattr(result, "segments", None) or []
        detected = None
        lang_attr = getattr(result, "language", None)
        if isinstance(lang_attr, list) and lang_attr:
            detected = lang_attr[0]
        elif isinstance(lang_attr, str):
            detected = lang_attr
        return segments, detected

    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """오디오 스트림을 청크 단위로 순차 변환한다."""
        async for chunk in audio_stream:
            segments = await self.transcribe(chunk)
            for seg in segments:
                yield seg


# 임의 부분문자열(unit)이 연속 4회 이상 반복되면 2회로 축약.
# 글자단위("상상상…", 공백없음), 단어단위("우리가우리가…"), 구절단위
# ("그런 식으로 그런 식으로 …") 폭주를 모두 잡는다. non-greedy라 unit은 최소 길이부터 탐색.
_REPEAT_RE = re.compile(r"(.+?)\1{3,}")


def _collapse_repetition(text: str, max_run: int = 2) -> str:
    """Whisper repetition loop 후처리: 연속 반복 폭주를 잘라낸다.

    condition_on_previous_text=True는 한국어 내용 보존에 유리하지만 가끔 한 세그먼트가
    동일 패턴으로 폭주한다. 두 종류:
    - 공백 없는 글자/패턴 반복("장상상상…상", "Next Next…"가 붙은 경우) → 정규식으로 축약
    - 공백 구분 동일 토큰("우리가 우리가 …") → 토큰 런 길이로 축약
    자연스러운 중첩("네 네", "감사합니다 감사합니다")은 max_run(2)개까지 살린다.
    """
    # 1) 부분문자열 반복(공백 유무 무관)을 정규식으로 2회까지 축약
    text = _REPEAT_RE.sub(lambda m: m.group(1) * 2, text)

    # 2) 공백 구분 동일 토큰 런 축약(정규식이 토큰 사이 공백 때문에 못 잡는 경우 보강)
    tokens = text.split()
    if len(tokens) <= max_run:
        return text
    out: list[str] = []
    run = 0
    prev = None
    for tok in tokens:
        if tok == prev:
            run += 1
        else:
            run = 1
            prev = tok
        if run <= max_run:
            out.append(tok)
    return " ".join(out)


def _seg_confidence(seg: dict) -> float:
    """whisper segment dict의 avg_logprob를 confidence로 사용(없으면 0.85)."""
    val = seg.get("avg_logprob")
    if isinstance(val, (int, float)):
        return float(val)
    return 0.85
