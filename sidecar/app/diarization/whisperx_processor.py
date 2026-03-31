"""WhisperXBatchProcessor: WhisperX 기반 배치 STT + 화자 분리.

녹음 완료 후 전체 오디오를 한 번에 처리하여
최고 정확도의 STT + 화자 분리 결과를 반환한다.

WhisperX 파이프라인:
1. Faster-Whisper ASR → 세그먼트 + 타임스탬프
2. Forced alignment → word-level 타임스탬프
3. pyannote 화자 분리 → 화자 세그먼트
4. assign_word_speakers → 화자 라벨을 세그먼트에 할당

pyannote 단독 대비 약 60% DER 감소 효과.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.stt.base import TranscriptSegment

_SAMPLE_RATE = 16000
_SEC_TO_MS = 1000


class WhisperXBatchProcessor:
    """WhisperX 기반 배치 STT + 화자 분리 프로세서."""

    def __init__(
        self,
        whisper_model: str = "large-v3-turbo",
        device: str = "cpu",
        compute_type: str = "int8",
        hf_token: str = "",
        batch_size: int = 8,
    ) -> None:
        self._whisper_model_name = whisper_model
        self._device = device
        self._compute_type = compute_type
        self._hf_token = hf_token
        self._batch_size = batch_size
        self._asr_model: Any = None
        self._diarize_pipeline: Any = None
        self._is_loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    async def load(self) -> None:
        """WhisperX 모델 및 화자 분리 파이프라인을 로드한다."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self) -> None:
        import whisperx

        print(f"[whisperx] ASR 모델 로딩: {self._whisper_model_name} ({self._device}, {self._compute_type})", flush=True)
        self._asr_model = whisperx.load_model(
            self._whisper_model_name,
            device=self._device,
            compute_type=self._compute_type,
        )

        if self._hf_token:
            print("[whisperx] 화자 분리 파이프라인 로딩...", flush=True)
            # WhisperX가 use_auth_token을 쓰지만 pyannote 4.x는 token= 사용
            # → monkey-patch로 호환
            from whisperx import diarize as _wx_diarize
            _orig_init = _wx_diarize.DiarizationPipeline.__init__

            def _patched_init(self_inner, model_name=None, use_auth_token=None, device="cpu"):
                import torch
                if isinstance(device, str):
                    device = torch.device(device)
                from pyannote.audio import Pipeline as _Pipeline
                model_config = model_name or "pyannote/speaker-diarization-3.1"
                self_inner.model = _Pipeline.from_pretrained(model_config, token=use_auth_token).to(device)

            _wx_diarize.DiarizationPipeline.__init__ = _patched_init
            try:
                self._diarize_pipeline = whisperx.DiarizationPipeline(
                    use_auth_token=self._hf_token,
                    device=self._device,
                )
            finally:
                _wx_diarize.DiarizationPipeline.__init__ = _orig_init
        else:
            print("[whisperx] HF 토큰 없음 — 화자 분리 비활성화", flush=True)

        self._is_loaded = True
        print("[whisperx] 로드 완료", flush=True)

    async def process_file(
        self,
        file_path: str,
        languages: list[str] | None = None,
    ) -> list[TranscriptSegment]:
        """오디오 파일을 WhisperX로 전체 처리한다.

        Args:
            file_path: PCM 16kHz mono Int16 raw 파일 또는 일반 오디오 파일 경로
            languages: 인식 대상 언어 코드 목록

        Returns:
            TranscriptSegment 리스트 (speaker_label 포함)
        """
        if not self._is_loaded:
            raise RuntimeError("WhisperXBatchProcessor가 로드되지 않았습니다.")

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._process_file_sync, file_path, languages)

    async def process_bytes(
        self,
        audio_bytes: bytes,
        languages: list[str] | None = None,
    ) -> list[TranscriptSegment]:
        """PCM 바이트를 WhisperX로 처리한다.

        Args:
            audio_bytes: PCM 16kHz mono Int16 바이너리
            languages: 인식 대상 언어 코드 목록

        Returns:
            TranscriptSegment 리스트 (speaker_label 포함)
        """
        if not self._is_loaded:
            raise RuntimeError("WhisperXBatchProcessor가 로드되지 않았습니다.")

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._process_bytes_sync, audio_bytes, languages)

    def _process_bytes_sync(
        self,
        audio_bytes: bytes,
        languages: list[str] | None = None,
    ) -> list[TranscriptSegment]:
        import numpy as np
        # PCM Int16 → float32 [-1, 1]
        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        return self._process_audio(audio, languages)

    def _process_file_sync(
        self,
        file_path: str,
        languages: list[str] | None = None,
    ) -> list[TranscriptSegment]:
        import numpy as np

        # PCM raw 파일 (확장자 .raw) → 직접 읽기
        if file_path.endswith(".raw"):
            with open(file_path, "rb") as f:
                audio = np.frombuffer(f.read(), dtype=np.int16).astype(np.float32) / 32768.0
        else:
            # 일반 오디오 파일 → whisperx의 load_audio 사용
            import whisperx
            audio = whisperx.load_audio(file_path, sr=_SAMPLE_RATE)

        return self._process_audio(audio, languages)

    def _process_audio(
        self,
        audio: Any,  # np.ndarray float32
        languages: list[str] | None = None,
    ) -> list[TranscriptSegment]:
        """WhisperX 전체 파이프라인 실행."""
        import whisperx

        duration_sec = len(audio) / _SAMPLE_RATE
        print(f"[whisperx] 처리 시작: {duration_sec:.1f}초", flush=True)

        # 1단계: ASR — 언어 지정 (첫 번째 언어 사용, 없으면 자동 감지)
        language = languages[0] if languages else None
        result = self._asr_model.transcribe(
            audio,
            batch_size=self._batch_size,
            language=language,
        )
        detected_lang = result.get("language", language or "auto")
        print(f"[whisperx] ASR 완료: {len(result.get('segments', []))}개 세그먼트, 언어={detected_lang}", flush=True)

        # 2단계: Forced alignment — word-level 타임스탬프
        try:
            align_model, align_metadata = whisperx.load_align_model(
                language_code=detected_lang,
                device=self._device,
            )
            result = whisperx.align(
                result["segments"],
                align_model,
                align_metadata,
                audio,
                self._device,
                return_char_alignments=False,
            )
            print(f"[whisperx] Alignment 완료", flush=True)
        except Exception as e:
            print(f"[whisperx] Alignment 실패 (무시): {e}", flush=True)

        # 3단계: 화자 분리 + 할당
        if self._diarize_pipeline is not None:
            try:
                diarize_segments = self._diarize_pipeline(audio)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                print(f"[whisperx] 화자 분리 완료", flush=True)
            except Exception as e:
                print(f"[whisperx] 화자 분리 실패 (무시): {e}", flush=True)

        # 4단계: TranscriptSegment 변환
        segments: list[TranscriptSegment] = []
        speaker_counter: dict[str, str] = {}  # SPEAKER_00 → 화자 1
        next_num = 1

        for seg in result.get("segments", []):
            text = seg.get("text", "").strip()
            if not text:
                continue

            start_ms = int(seg.get("start", 0) * _SEC_TO_MS)
            end_ms = int(seg.get("end", 0) * _SEC_TO_MS)
            lang = seg.get("language", detected_lang) or detected_lang

            # WhisperX 화자 라벨 → "화자 N" 형식으로 변환
            raw_speaker = seg.get("speaker", None)
            speaker_label = None
            if raw_speaker:
                if raw_speaker not in speaker_counter:
                    speaker_counter[raw_speaker] = f"화자 {next_num}"
                    next_num += 1
                speaker_label = speaker_counter[raw_speaker]

            segments.append(TranscriptSegment(
                text=text,
                started_at_ms=start_ms,
                ended_at_ms=end_ms,
                language=lang,
                confidence=0.0,
                speaker_label=speaker_label,
            ))

        print(f"[whisperx] 최종: {len(segments)}개 세그먼트, {len(speaker_counter)}명 화자", flush=True)
        return segments
