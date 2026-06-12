"""BatchDiarizer: 전체 오디오에 pyannote 파이프라인을 한 번에 실행하는 배치 화자 분리.

파일 전사(/transcribe-file) 시 사용. 짧은 청크 대신 전체 오디오를 한 번에 처리.
community-1의 exclusive_speaker_diarization(비겹침, STT 정합용)을 우선 사용하고,
화자 embedding을 회의별 SpeakerDB에 등록해 rename/reset API와 연동한다.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.audio_constants import (
    SAMPLE_RATE as _SAMPLE_RATE,
    BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE,
    SEC_TO_MS as _SEC_TO_MS,
)
from app.diarization.overlap import assign_speaker_summed
from app.diarization.speaker_db import SpeakerDB, is_valid_embedding
from app.stt.base import TranscriptSegment

logger = logging.getLogger(__name__)

# community-1 기본값 (HF config.yaml과 동일) — threshold만 사용자 조정, Fa/Fb는 고정
_VBX_FA = 0.07
_VBX_FB = 0.8
_SEG_MIN_DURATION_OFF = 0.0
_DEFAULT_CLUSTERING_THRESHOLD = 0.6


async def batch_diarize(
    audio_bytes: bytes,
    pipeline: Any,
    segments: list[TranscriptSegment],
    meeting_id: int | None = None,
    db_dir: Path | None = None,
    expected_speakers: int | None = None,
    clustering_threshold: float | None = None,
) -> list[TranscriptSegment]:
    """전체 오디오 diarization 후 STT 세그먼트에 화자를 할당한다.

    meeting_id가 있으면 화자 embedding을 SpeakerDB(meeting_<id>.json)에 등록해
    rename/reset API가 동작하게 한다. 재실행 시 기존 화자 이름(names)은 유지.

    expected_speakers: 회의별 참여인원 힌트. N±2 범위로 클러스터 수를 가드한다.
    clustering_threshold: VBxClustering AHC 임계값 (기본 0.6, 낮을수록 잘게 분리).
    """
    if not segments or len(audio_bytes) < _SAMPLE_RATE * _BYTES_PER_SAMPLE:
        return segments

    loop = asyncio.get_running_loop()
    turns, embeddings, ordered_labels = await loop.run_in_executor(
        None, _run_full_pipeline, audio_bytes, pipeline, expected_speakers, clustering_threshold
    )

    if not turns:
        return segments

    for seg in segments:
        speaker = assign_speaker_summed(seg.started_at_ms, seg.ended_at_ms, turns)
        if speaker:
            seg.speaker_label = speaker

    if meeting_id is not None:
        _register_speakers(meeting_id, ordered_labels, embeddings, db_dir)

    return segments


def _run_full_pipeline(
    audio_bytes: bytes,
    pipeline: Any,
    expected_speakers: int | None = None,
    clustering_threshold: float | None = None,
) -> tuple[list[tuple[int, int, str]], Any, list[str]]:
    """pyannote 파이프라인 실행 → (turns, embeddings, '화자 N' 순서 라벨).

    expected_speakers: 회의별 참여인원 힌트(양수만 적용). N±2 범위로 클러스터 수를 가드한다.
    clustering_threshold: VBxClustering AHC 임계값. None이면 기본값 0.6으로 명시 설정.
    """
    import torch

    from app.stt.audio_utils import pcm_bytes_to_float32

    audio_array = pcm_bytes_to_float32(audio_bytes)
    duration_sec = len(audio_array) / _SAMPLE_RATE
    logger.info(f"[batch-diarizer] 전체 오디오 처리: {duration_sec:.1f}초")

    waveform = torch.from_numpy(audio_array).unsqueeze(0)
    audio_input = {"waveform": waveform, "sample_rate": _SAMPLE_RATE}

    # 클러스터링 세밀도: 싱글턴 파이프라인이라 매 호출 명시 설정(이전 호출 잔류값 방지).
    # 미지정이어도 기본값으로 항상 instantiate — 이전 호출의 threshold가 남지 않도록.
    # gpu_lock 안에서만 호출되므로 동시 변경 없음.
    effective_threshold = (
        clustering_threshold if clustering_threshold is not None
        else _DEFAULT_CLUSTERING_THRESHOLD
    )
    pipeline.instantiate({
        "clustering": {"threshold": float(effective_threshold), "Fa": _VBX_FA, "Fb": _VBX_FB},
        "segmentation": {"min_duration_off": _SEG_MIN_DURATION_OFF},
    })

    # 참여인원 힌트: N±2 범위로 클러스터 수를 가드 (자동 감지 결과가 범위 밖일 때만 개입)
    call_kwargs: dict[str, int] = {}
    if expected_speakers and expected_speakers > 0:
        call_kwargs["min_speakers"] = max(1, expected_speakers - 2)
        call_kwargs["max_speakers"] = expected_speakers + 2
        logger.info(f"[batch-diarizer] 화자 수 힌트: {call_kwargs['min_speakers']}~{call_kwargs['max_speakers']}명")

    output = pipeline(audio_input, **call_kwargs)
    # community-1: exclusive_speaker_diarization = 비겹침 타임라인 (STT 정합 전용 설계)
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = output.speaker_diarization
    embeddings = getattr(output, "speaker_embeddings", None)

    # 라벨 정렬: speaker_diarization.labels() 순서 = embeddings 행 순서 (pyannote 보장)
    raw_labels = output.speaker_diarization.labels()
    label_map = {label: f"화자 {i + 1}" for i, label in enumerate(raw_labels)}
    ordered_labels = [label_map[label] for label in raw_labels]

    turns: list[tuple[int, int, str]] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        turns.append((
            int(turn.start * _SEC_TO_MS),
            int(turn.end * _SEC_TO_MS),
            label_map.get(speaker, "화자 1"),
        ))

    logger.info(f"[batch-diarizer] 완료: {len(raw_labels)}명 화자, {len(turns)}개 구간")
    return turns, embeddings, ordered_labels


def _register_speakers(
    meeting_id: int,
    ordered_labels: list[str],
    embeddings: Any,
    db_dir: Path | None = None,
) -> None:
    """배치 결과 화자를 SpeakerDB에 등록한다 (rename/reset API 연동).

    배치 결과가 항상 최종본이므로 embedding은 전부 교체하되,
    사용자가 부여한 이름(names)은 같은 '화자 N' 키로 유지한다.
    """
    import numpy as np

    if db_dir is None:
        from app.diarization.speaker import _get_db_dir
        db_dir = _get_db_dir()
    db = SpeakerDB(Path(db_dir) / f"meeting_{meeting_id}.json")
    db.load()
    old_names = dict(db.names)

    db.embeddings = {}
    for i, label in enumerate(ordered_labels):
        if embeddings is not None and i < len(embeddings):
            emb = np.asarray(embeddings[i], dtype=np.float32)
            if is_valid_embedding(emb):
                norm = np.linalg.norm(emb)
                db.embeddings[label] = [emb / norm]
                continue
        db.embeddings[label] = []  # embedding 없어도 rename 가능하도록 키는 유지
    db.names = {k: v for k, v in old_names.items() if k in db.embeddings}
    db.next_num = len(ordered_labels) + 1
    db.save()
    logger.info(f"[batch-diarizer] SpeakerDB 등록: meeting={meeting_id}, {len(ordered_labels)}명")
