"""BatchDiarizer: 전체 오디오에 pyannote 파이프라인을 한 번에 실행하는 배치 화자 분리.

파일 전사(/transcribe-file) 시 사용.
짧은 청크 대신 전체 오디오(수 분~수 시간)를 한 번에 처리하여
pyannote가 최적의 화자 분리를 수행한다.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.stt.base import TranscriptSegment

_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2
_SEC_TO_MS = 1000

# 배치 처리용 임계값 (전체 오디오 → 안정적 embedding)
_SIMILARITY_THRESHOLD = 0.40
_MERGE_THRESHOLD = 0.55
_MAX_EMBEDDINGS_PER_SPEAKER = 20


async def batch_diarize(
    audio_bytes: bytes,
    pipeline: Any,
    segments: list[TranscriptSegment],
) -> list[TranscriptSegment]:
    """전체 오디오에 pyannote 파이프라인을 실행하고 STT 세그먼트에 화자를 할당한다.

    Args:
        audio_bytes: PCM 16kHz mono Int16 전체 오디오
        pipeline: pyannote.audio Pipeline 인스턴스
        segments: STT로 생성된 TranscriptSegment 리스트

    Returns:
        speaker_label이 할당된 TranscriptSegment 리스트
    """
    if not segments or len(audio_bytes) < _SAMPLE_RATE * _BYTES_PER_SAMPLE:
        return segments

    loop = asyncio.get_running_loop()
    diarization = await loop.run_in_executor(
        None, _run_full_pipeline, audio_bytes, pipeline
    )

    if not diarization:
        return segments

    # STT 세그먼트에 화자 할당
    for seg in segments:
        speaker = _find_speaker(seg.started_at_ms, seg.ended_at_ms, diarization)
        if speaker:
            seg.speaker_label = speaker

    return segments


def _run_full_pipeline(
    audio_bytes: bytes,
    pipeline: Any,
) -> dict[tuple[int, int], str]:
    """pyannote 파이프라인을 전체 오디오에 실행한다."""
    import numpy as np
    import torch

    audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    duration_sec = len(audio_array) / _SAMPLE_RATE
    print(f"[batch-diarizer] 전체 오디오 처리: {duration_sec:.1f}초", flush=True)

    waveform = torch.from_numpy(audio_array).unsqueeze(0)
    audio_input = {"waveform": waveform, "sample_rate": _SAMPLE_RATE}

    output = pipeline(audio_input)
    annotation = output.speaker_diarization

    # pyannote 로컬 라벨 → "화자 N" 매핑
    labels = annotation.labels()
    label_map: dict[str, str] = {}
    for i, label in enumerate(labels):
        label_map[label] = f"화자 {i + 1}"

    result: dict[tuple[int, int], str] = {}
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        start_ms = int(turn.start * _SEC_TO_MS)
        end_ms = int(turn.end * _SEC_TO_MS)
        result[(start_ms, end_ms)] = label_map.get(speaker, "화자 1")

    num_speakers = len(labels)
    print(f"[batch-diarizer] 완료: {num_speakers}명 화자, {len(result)}개 구간", flush=True)
    return result


def _find_speaker(
    start_ms: int,
    end_ms: int,
    diarization: dict[tuple[int, int], str],
) -> str | None:
    best_speaker: str | None = None
    best_overlap: int = 0
    for (d_start, d_end), speaker in diarization.items():
        overlap = max(0, min(end_ms, d_end) - max(start_ms, d_start))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = speaker
    return best_speaker
