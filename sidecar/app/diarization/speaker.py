"""SpeakerDiarizer: pyannote.audio 4.x 기반 화자 분리 (회의별 일관성 보장).

짧은 청크(2~5s)에서 동일 화자라도 embedding이 크게 달라지는 문제를 해결하기 위해:
- 화자당 최근 embedding N개를 보관 (multi-vector)
- 매칭 시 모든 저장 벡터 중 최대 유사도 사용
- 각 청크 처리 후 유사한 화자 쌍을 사후 병합 (post-merge)
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.diarization.overlap import find_speaker_by_overlap
from app.diarization.speaker_db import SpeakerDB, is_valid_embedding
from app.stt.base import TranscriptSegment

if TYPE_CHECKING:
    import numpy as np

from app.audio_constants import (
    SAMPLE_RATE as _SAMPLE_RATE,
    BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE,
    SEC_TO_MS as _SEC_TO_MS,
    MIN_AUDIO_BYTES as _MIN_AUDIO_BYTES,
)

logger = logging.getLogger(__name__)

_PIPELINE_MODEL = "pyannote/speaker-diarization-community-1"

# 임계값 상향: 0.10이 너무 낮아 다른 화자도 같은 화자로 매칭되던 문제 수정
_SIMILARITY_THRESHOLD = 0.35   # 이 이상이면 기존 화자로 매칭 (기존 0.10 → 0.35)
_MERGE_THRESHOLD = 0.50        # 이 이상이면 두 화자를 같은 사람으로 사후 병합 (기존 0.35 → 0.50)
_MAX_EMBEDDINGS_PER_SPEAKER = 15  # 화자당 보관할 최대 embedding 수
_MAX_SPEAKERS = 10                # 최대 화자 수

# 회의별 DB 저장 디렉터리: SPEAKER_DBS_DIR 환경변수 또는 sidecar/speaker_dbs/
def _get_db_dir() -> Path:
    from app.config import settings
    if settings.SPEAKER_DBS_DIR:
        return Path(settings.SPEAKER_DBS_DIR)
    return Path(__file__).parent.parent.parent / "speaker_dbs"


class SpeakerDiarizer:
    """pyannote.audio 4.x 기반 화자 분리기 (multi-vector 매칭).

    - pipeline=None 이면 load()로 ML 파이프라인 초기화
    - pipeline이 주어지면 즉시 사용 가능 (파이프라인 공유)
    - 화자 DB는 db_path에 JSON으로 영속 저장됨
    """

    def __init__(
        self,
        db_path: Path | str | None = None,
        pipeline: Any = None,
        similarity_threshold: float | None = None,
        merge_threshold: float | None = None,
        max_embeddings_per_speaker: int | None = None,
    ) -> None:
        self._pipeline = pipeline
        self._is_loaded: bool = pipeline is not None
        self._similarity_threshold = similarity_threshold if similarity_threshold is not None else _SIMILARITY_THRESHOLD
        self._merge_threshold = merge_threshold if merge_threshold is not None else _MERGE_THRESHOLD
        self._max_embeddings = max_embeddings_per_speaker if max_embeddings_per_speaker is not None else _MAX_EMBEDDINGS_PER_SPEAKER
        # 매칭 상태(embeddings/names/next_num)는 SpeakerDB가 보관·영속화한다
        self._db_path = Path(db_path) if db_path else None
        self._db = SpeakerDB(self._db_path)
        if self._is_loaded and self._db_path:
            self._load_db()

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @property
    def pipeline(self) -> Any:
        """공유 가능한 ML 파이프라인 참조."""
        return self._pipeline

    def update_config(
        self,
        similarity_threshold: float | None = None,
        merge_threshold: float | None = None,
        max_embeddings_per_speaker: int | None = None,
    ) -> None:
        """런타임에 분리 설정을 변경한다."""
        if similarity_threshold is not None:
            self._similarity_threshold = similarity_threshold
        if merge_threshold is not None:
            self._merge_threshold = merge_threshold
        if max_embeddings_per_speaker is not None:
            self._max_embeddings = max_embeddings_per_speaker

    async def load(self, hf_token: str = "") -> None:
        """pyannote.audio Pipeline을 로드한다."""
        try:
            from pyannote.audio import Pipeline  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "pyannote.audio가 설치되어 있지 않습니다. "
                "'uv add pyannote.audio'로 설치 후 재시작하세요."
            ) from e

        from pyannote.audio import Pipeline

        def _load():
            import os
            os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
            from app.diarization.device import pick_device
            pipeline = Pipeline.from_pretrained(_PIPELINE_MODEL, token=hf_token or None)
            device = pick_device()
            pipeline.to(device)
            logger.info(f"[diarizer] pipeline loaded: {_PIPELINE_MODEL} on {device}")
            if hasattr(pipeline, "num_workers"):
                pipeline.num_workers = 0
            return pipeline

        loop = asyncio.get_running_loop()
        self._pipeline = await loop.run_in_executor(None, _load)
        self._is_loaded = True
        if self._db_path:
            self._load_db()

    # ── 화자 DB 영속화 ────────────────────────────────────────────────────────

    def _load_db(self) -> None:
        self._db.load()

    def _save_db(self) -> None:
        self._db.save()

    def _fallback_speaker(self) -> str:
        """기존 화자가 있으면 마지막 화자를, 없으면 새 화자 번호를 발급한다."""
        if self._db.embeddings:
            return list(self._db.embeddings.keys())[-1]
        new_id = f"화자 {self._db.next_num}"
        self._db.next_num += 1
        return new_id

    # ── 화자 이름 관리 ────────────────────────────────────────────────────────

    def get_speakers(self) -> list[dict]:
        return [
            {"id": label, "name": self._db.names.get(label, label)}
            for label in self._db.embeddings
        ]

    def rename_speaker(self, speaker_id: str, name: str) -> bool:
        if speaker_id not in self._db.embeddings:
            return False
        self._db.names[speaker_id] = name
        self._save_db()
        return True

    def reset_db(self) -> None:
        self._db.reset()
        logger.info(f"[diarizer] 화자 DB 초기화 완료 ({self._db_path})")

    # ── 화자 분리 ─────────────────────────────────────────────────────────────

    async def diarize(self, audio_bytes: bytes, offset_ms: int = 0) -> dict[tuple[int, int], str]:
        if not self._is_loaded:
            raise RuntimeError("SpeakerDiarizer가 로드되지 않았습니다.")
        if len(audio_bytes) < _MIN_AUDIO_BYTES:
            return {}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._run_pipeline, audio_bytes)

    def _run_pipeline(self, audio_bytes: bytes) -> dict[tuple[int, int], str]:
        import torch

        from app.stt.audio_utils import pcm_bytes_to_float32

        audio_array = pcm_bytes_to_float32(audio_bytes)
        waveform = torch.from_numpy(audio_array).unsqueeze(0)
        audio_input = {"waveform": waveform, "sample_rate": _SAMPLE_RATE}

        output = self._pipeline(audio_input)
        annotation = output.speaker_diarization
        centroids = output.speaker_embeddings  # (num_speakers, dim) or None

        if centroids is None:
            logger.warning("[diarizer] WARNING: speaker_embeddings is None — fallback to sequential IDs")

        labels = annotation.labels()
        num_local_speakers = len(labels)

        local_to_meeting: dict[str, str] = {}
        for i, label in enumerate(labels):
            if centroids is not None and i < len(centroids):
                emb = centroids[i]
                if not is_valid_embedding(emb):
                    logger.warning(f"[diarizer] WARNING: invalid embedding for {label} — skip")
                    # 유효하지 않은 embedding → 가장 최근 화자 또는 "화자 1"
                    meeting_id = self._fallback_speaker()
                else:
                    # force_match 제거: 단일 화자 청크에서도 새 화자 생성 허용
                    meeting_id = self._match_or_create(emb, force_match=False)
            else:
                # centroids 없음 — 기존 화자가 있으면 마지막 화자, 없으면 새로 생성
                meeting_id = self._fallback_speaker()
            local_to_meeting[label] = meeting_id

        # 사후 병합: 유사한 화자 쌍을 하나로 합침
        self._merge_similar_speakers()
        # local→meeting 맵에 병합 결과 반영
        local_to_meeting = {
            loc: self._resolve_merged(glo)
            for loc, glo in local_to_meeting.items()
        }

        result: dict[tuple[int, int], str] = {}
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            start_ms = int(turn.start * _SEC_TO_MS)
            end_ms = int(turn.end * _SEC_TO_MS)
            result[(start_ms, end_ms)] = local_to_meeting.get(speaker, "화자 1")

        self._save_db()
        return result

    def _resolve_merged(self, speaker_id: str) -> str:
        """병합으로 삭제된 화자 ID를 현재 유효한 ID로 대체한다."""
        return speaker_id if speaker_id in self._db.embeddings else "화자 1"

    def _match_or_create(self, embedding: Any, force_match: bool = False) -> str:
        """multi-vector 최대 유사도로 기존 화자 매칭, 없으면 새 화자 생성.

        Args:
            embedding: L2-정규화 전 raw embedding
            force_match: True이면 임계값 무시하고 가장 가까운 화자에 강제 매칭
                         (단일 화자 청크에서 사용 — 새 화자 생성 방지)
        """
        import numpy as np

        norm = np.linalg.norm(embedding)
        if norm < 1e-8:
            # 제로 벡터 — 매칭 불가, 기존 화자가 있으면 마지막 화자 반환
            return self._fallback_speaker()
        emb_norm = embedding / norm

        best_id: str | None = None
        best_sim = -1.0
        all_sims: dict[str, float] = {}
        for spk_id, emb_list in self._db.embeddings.items():
            # NaN-safe: 유효한 embedding만 비교
            valid_sims = []
            for e in emb_list:
                s = float(np.dot(emb_norm, e))
                if not (np.isnan(s) or np.isinf(s)):
                    valid_sims.append(s)
            sim = max(valid_sims) if valid_sims else -1.0
            all_sims[spk_id] = sim
            if sim > best_sim:
                best_sim = sim
                best_id = spk_id

        # force_match: 임계값 무시, 가장 가까운 화자에 매칭
        matched = best_id is not None and (best_sim >= self._similarity_threshold or force_match)
        action = f"{'force-' if force_match and best_sim < self._similarity_threshold else ''}match:{best_id}" if matched else "new"
        logger.info(
            f"[diarizer] sims={{{', '.join(f'{k}:{v:.3f}' for k, v in all_sims.items())}}} "
            f"→ {action} (best={best_sim:.3f})"
        )

        # 최대 화자 수에 도달하면 강제 매칭
        if not matched and len(self._db.embeddings) >= _MAX_SPEAKERS:
            if best_id is not None:
                matched = True
                action = f"force-max-speakers:{best_id}"
                logger.info(
                    f"[diarizer] 최대 화자 수({_MAX_SPEAKERS})에 도달 → {action} (sim={best_sim:.3f})"
                )

        if matched:
            self._db.embeddings[best_id].append(emb_norm)
            if len(self._db.embeddings[best_id]) > self._max_embeddings:
                self._db.embeddings[best_id].pop(0)
            return best_id

        new_id = f"화자 {self._db.next_num}"
        self._db.next_num += 1
        self._db.embeddings[new_id] = [emb_norm]
        return new_id

    def _merge_similar_speakers(self) -> None:
        """유사도가 높은 화자 쌍을 병합한다 (번호 작은 쪽 기준으로 흡수)."""
        import numpy as np

        merged = True
        while merged:
            merged = False
            ids = list(self._db.embeddings.keys())
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    a, b = ids[i], ids[j]
                    if a not in self._db.embeddings or b not in self._db.embeddings:
                        continue
                    all_pair_sims = [
                        float(np.dot(ea, eb))
                        for ea in self._db.embeddings[a]
                        for eb in self._db.embeddings[b]
                    ]
                    # NaN 제거
                    valid_pair_sims = [s for s in all_pair_sims if not (np.isnan(s) or np.isinf(s))]
                    max_sim = max(valid_pair_sims) if valid_pair_sims else -1.0
                    if max_sim >= self._merge_threshold:
                        # b → a 흡수
                        self._db.embeddings[a].extend(self._db.embeddings.pop(b))
                        self._db.embeddings[a] = (
                            self._db.embeddings[a][-self._max_embeddings:]
                        )
                        if b in self._db.names and a not in self._db.names:
                            self._db.names[a] = self._db.names.pop(b)
                        else:
                            self._db.names.pop(b, None)
                        logger.info(f"[diarizer] merge: {b} → {a} (sim={max_sim:.3f})")
                        merged = True
                        break
                if merged:
                    break

    def merge_with_segments(
        self,
        segments: list[TranscriptSegment],
        diarization: dict[tuple[int, int], str],
    ) -> list[TranscriptSegment]:
        for seg in segments:
            speaker = find_speaker_by_overlap(seg.started_at_ms, seg.ended_at_ms, diarization)
            if speaker is not None:
                seg.speaker_label = speaker
        return segments


def make_meeting_diarizer(meeting_id: int, pipeline: Any, **kwargs) -> SpeakerDiarizer:
    db_path = _get_db_dir() / f"meeting_{meeting_id}.json"
    return SpeakerDiarizer(db_path=db_path, pipeline=pipeline, **kwargs)
