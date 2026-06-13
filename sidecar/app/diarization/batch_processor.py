"""BatchDiarizer: 전체 오디오에 speakrs(Rust/CoreML)를 실행하는 배치 화자 분리.

파일 전사(/transcribe-file) 시 사용. 짧은 청크 대신 전체 오디오를 한 번에 처리하고,
화자 라벨('화자 N')을 회의별 SpeakerDB에 등록해 rename/reset API와 연동한다.
"""
from __future__ import annotations

import asyncio
import logging
from functools import partial
from pathlib import Path
from typing import Any

from app.audio_constants import (
    SAMPLE_RATE as _SAMPLE_RATE,
    BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE,
)
from app.diarization.overlap import assign_speaker_summed
from app.diarization.speaker_db import SpeakerDB, is_valid_embedding
from app.stt.base import TranscriptSegment

logger = logging.getLogger(__name__)


async def batch_diarize_speakrs(
    audio_bytes: bytes,
    segments: list[TranscriptSegment],
    meeting_id: int | None = None,
    db_dir: Path | None = None,
    ahc_threshold: float | None = None,
) -> list[TranscriptSegment]:
    """speakrs(Rust/CoreML)로 전체 오디오 diarization 후 STT 세그먼트에 화자 할당.

    단일 화자분리 엔진. 화자 임베딩은 v1에선 비움(배치 재전사용).
    rename/reset은 '화자 N' 키만으로 동작하므로 빈 임베딩으로도 정상.
    """
    if not segments or len(audio_bytes) < _SAMPLE_RATE * _BYTES_PER_SAMPLE:
        return segments

    from app.diarization.speakrs_runner import run_speakrs

    loop = asyncio.get_running_loop()
    turns, ordered_labels = await loop.run_in_executor(
        None, partial(run_speakrs, audio_bytes, ahc_threshold=ahc_threshold)
    )

    logger.info(f"[speakrs] {len(ordered_labels)}명 화자, {len(turns)}개 구간")
    if not turns:
        return segments

    for seg in segments:
        speaker = assign_speaker_summed(seg.started_at_ms, seg.ended_at_ms, turns)
        if speaker:
            seg.speaker_label = speaker

    if meeting_id is not None:
        # embeddings=None → SpeakerDB에 '화자 N' 키만 빈 임베딩으로 등록 (rename 동작)
        _register_speakers(meeting_id, ordered_labels, None, db_dir)

    return segments


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
