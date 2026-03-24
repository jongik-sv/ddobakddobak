"""SpeakerDiarizer: pyannote.audio 4.x 기반 화자 분리 (회의별 일관성 보장).

짧은 청크(2~5s)에서 동일 화자라도 embedding이 크게 달라지는 문제를 해결하기 위해:
- 화자당 최근 embedding N개를 보관 (multi-vector)
- 매칭 시 모든 저장 벡터 중 최대 유사도 사용
- 각 청크 처리 후 유사한 화자 쌍을 사후 병합 (post-merge)
"""
from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.stt.base import TranscriptSegment

if TYPE_CHECKING:
    import numpy as np

_PIPELINE_MODEL = "pyannote/speaker-diarization-3.1"
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # Int16
_SEC_TO_MS = 1000
_MIN_AUDIO_BYTES = _SAMPLE_RATE * _BYTES_PER_SAMPLE  # 1초 미만은 불안정

# 짧은 청크에서 동일 화자 유사도 실측값이 0.05~0.25 수준 → 매우 낮게 설정
_SIMILARITY_THRESHOLD = 0.10   # 이 이상이면 기존 화자로 매칭
_MERGE_THRESHOLD = 0.35        # 이 이상이면 두 화자를 같은 사람으로 사후 병합
_MAX_EMBEDDINGS_PER_SPEAKER = 10  # 화자당 보관할 최대 embedding 수
_MAX_SPEAKERS = 10                # 최대 화자 수

# 회의별 DB 저장 디렉터리: sidecar/speaker_dbs/
_DEFAULT_DB_DIR = Path(__file__).parent.parent.parent / "speaker_dbs"


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
        # 화자 DB: {speaker_id: [emb0, emb1, ...]}  (각 emb는 L2-정규화된 np.ndarray)
        self._speaker_embeddings: dict[str, list[Any]] = {}
        self._speaker_names: dict[str, str] = {}
        self._next_num: int = 1
        self._db_path = Path(db_path) if db_path else None
        if self._is_loaded and self._db_path:
            self._load_db()

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    async def load(self, hf_token: str = "") -> None:
        """pyannote.audio Pipeline을 로드한다."""
        try:
            from pyannote.audio import Pipeline  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "pyannote.audio가 설치되어 있지 않습니다. "
                "'uv add pyannote.audio'로 설치 후 재시작하세요."
            ) from e

        import torch
        from pyannote.audio import Pipeline

        def _load():
            import os
            os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
            pipeline = Pipeline.from_pretrained(_PIPELINE_MODEL, token=hf_token or None)
            pipeline.to(torch.device("cpu"))
            if hasattr(pipeline, "num_workers"):
                pipeline.num_workers = 0
            return pipeline

        loop = asyncio.get_running_loop()
        self._pipeline = await loop.run_in_executor(None, _load)
        self._is_loaded = True
        if self._db_path:
            self._load_db()

    # ── 화자 DB 영속화 ────────────────────────────────────────────────────────

    @staticmethod
    def _is_valid_embedding(emb: Any) -> bool:
        """NaN, Inf, 제로 벡터를 거른다."""
        import numpy as np
        if emb is None or not hasattr(emb, '__len__') or len(emb) == 0:
            return False
        if np.any(np.isnan(emb)) or np.any(np.isinf(emb)):
            return False
        if np.linalg.norm(emb) < 1e-6:
            return False
        return True

    def _load_db(self) -> None:
        import numpy as np

        if not self._db_path or not self._db_path.exists():
            return
        try:
            with open(self._db_path, encoding="utf-8") as f:
                data = json.load(f)
            self._next_num = data.get("next_num", 1)
            self._speaker_names = data.get("names", {})
            for label, emb_list in data.get("speakers", {}).items():
                if isinstance(emb_list, list):
                    raw_embs = [
                        np.frombuffer(base64.b64decode(b64), dtype=np.float32).copy()
                        for b64 in emb_list
                    ]
                else:
                    raw = base64.b64decode(emb_list)
                    raw_embs = [np.frombuffer(raw, dtype=np.float32).copy()]
                # 오염된 embedding 필터링
                valid_embs = [e for e in raw_embs if self._is_valid_embedding(e)]
                if valid_embs:
                    self._speaker_embeddings[label] = valid_embs
            # embedding이 없는 화자의 이름도 제거
            valid_ids = set(self._speaker_embeddings.keys())
            self._speaker_names = {k: v for k, v in self._speaker_names.items() if k in valid_ids}
            print(
                f"[diarizer] 화자 DB 로드: {len(self._speaker_embeddings)}명 복원 ({self._db_path})",
                flush=True,
            )
        except Exception as e:
            print(f"[diarizer] 화자 DB 로드 실패 (빈 DB로 시작): {e}", flush=True)

    def _save_db(self) -> None:
        if not self._db_path:
            return
        try:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            speakers = {
                label: [
                    base64.b64encode(emb.astype("float32").tobytes()).decode()
                    for emb in emb_list
                ]
                for label, emb_list in self._speaker_embeddings.items()
            }
            with open(self._db_path, "w", encoding="utf-8") as f:
                json.dump(
                    {"next_num": self._next_num, "speakers": speakers, "names": self._speaker_names},
                    f,
                    ensure_ascii=False,
                )
        except Exception as e:
            print(f"[diarizer] 화자 DB 저장 실패: {e}", flush=True)

    # ── 화자 이름 관리 ────────────────────────────────────────────────────────

    def get_speakers(self) -> list[dict]:
        return [
            {"id": label, "name": self._speaker_names.get(label, label)}
            for label in self._speaker_embeddings
        ]

    def rename_speaker(self, speaker_id: str, name: str) -> bool:
        if speaker_id not in self._speaker_embeddings:
            return False
        self._speaker_names[speaker_id] = name
        self._save_db()
        return True

    def reset_db(self) -> None:
        self._speaker_embeddings.clear()
        self._speaker_names.clear()
        self._next_num = 1
        if self._db_path and self._db_path.exists():
            self._db_path.unlink()
        print(f"[diarizer] 화자 DB 초기화 완료 ({self._db_path})", flush=True)

    # ── 화자 분리 ─────────────────────────────────────────────────────────────

    async def diarize(self, audio_bytes: bytes) -> dict[tuple[int, int], str]:
        if not self._is_loaded:
            raise RuntimeError("SpeakerDiarizer가 로드되지 않았습니다.")
        if len(audio_bytes) < _MIN_AUDIO_BYTES:
            return {}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._run_pipeline, audio_bytes)

    def _run_pipeline(self, audio_bytes: bytes) -> dict[tuple[int, int], str]:
        import numpy as np
        import torch

        audio_array = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        waveform = torch.from_numpy(audio_array).unsqueeze(0)
        audio_input = {"waveform": waveform, "sample_rate": _SAMPLE_RATE}

        output = self._pipeline(audio_input)
        annotation = output.speaker_diarization
        centroids = output.speaker_embeddings  # (num_speakers, dim) or None

        if centroids is None:
            print("[diarizer] WARNING: speaker_embeddings is None — fallback to sequential IDs", flush=True)

        labels = annotation.labels()
        num_local_speakers = len(labels)

        local_to_meeting: dict[str, str] = {}
        for i, label in enumerate(labels):
            if centroids is not None and i < len(centroids):
                emb = centroids[i]
                if not self._is_valid_embedding(emb):
                    print(f"[diarizer] WARNING: invalid embedding for {label} — skip", flush=True)
                    # 유효하지 않은 embedding → 가장 최근 화자 또는 "화자 1"
                    if self._speaker_embeddings:
                        meeting_id = list(self._speaker_embeddings.keys())[-1]
                    else:
                        meeting_id = f"화자 {self._next_num}"
                        self._next_num += 1
                else:
                    # 단일 화자 청크 + DB에 기존 화자 있음 → 강제 매칭 (새 화자 생성 안함)
                    force_match = (num_local_speakers == 1 and len(self._speaker_embeddings) > 0)
                    meeting_id = self._match_or_create(emb, force_match=force_match)
            else:
                # centroids 없음 — 기존 화자가 있으면 마지막 화자, 없으면 새로 생성
                if self._speaker_embeddings:
                    meeting_id = list(self._speaker_embeddings.keys())[-1]
                else:
                    meeting_id = f"화자 {self._next_num}"
                    self._next_num += 1
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
        return speaker_id if speaker_id in self._speaker_embeddings else "화자 1"

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
            if self._speaker_embeddings:
                return list(self._speaker_embeddings.keys())[-1]
            new_id = f"화자 {self._next_num}"
            self._next_num += 1
            return new_id
        emb_norm = embedding / norm

        best_id: str | None = None
        best_sim = -1.0
        all_sims: dict[str, float] = {}
        for spk_id, emb_list in self._speaker_embeddings.items():
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
        print(
            f"[diarizer] sims={{{', '.join(f'{k}:{v:.3f}' for k, v in all_sims.items())}}} "
            f"→ {action} (best={best_sim:.3f})",
            flush=True,
        )

        # 최대 화자 수에 도달하면 강제 매칭
        if not matched and len(self._speaker_embeddings) >= _MAX_SPEAKERS:
            if best_id is not None:
                matched = True
                action = f"force-max-speakers:{best_id}"
                print(
                    f"[diarizer] 최대 화자 수({_MAX_SPEAKERS})에 도달 → {action} (sim={best_sim:.3f})",
                    flush=True,
                )

        if matched:
            self._speaker_embeddings[best_id].append(emb_norm)
            if len(self._speaker_embeddings[best_id]) > self._max_embeddings:
                self._speaker_embeddings[best_id].pop(0)
            return best_id

        new_id = f"화자 {self._next_num}"
        self._next_num += 1
        self._speaker_embeddings[new_id] = [emb_norm]
        return new_id

    def _merge_similar_speakers(self) -> None:
        """유사도가 높은 화자 쌍을 병합한다 (번호 작은 쪽 기준으로 흡수)."""
        import numpy as np

        merged = True
        while merged:
            merged = False
            ids = list(self._speaker_embeddings.keys())
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    a, b = ids[i], ids[j]
                    if a not in self._speaker_embeddings or b not in self._speaker_embeddings:
                        continue
                    all_pair_sims = [
                        float(np.dot(ea, eb))
                        for ea in self._speaker_embeddings[a]
                        for eb in self._speaker_embeddings[b]
                    ]
                    # NaN 제거
                    valid_pair_sims = [s for s in all_pair_sims if not (np.isnan(s) or np.isinf(s))]
                    max_sim = max(valid_pair_sims) if valid_pair_sims else -1.0
                    if max_sim >= self._merge_threshold:
                        # b → a 흡수
                        self._speaker_embeddings[a].extend(self._speaker_embeddings.pop(b))
                        self._speaker_embeddings[a] = (
                            self._speaker_embeddings[a][-self._max_embeddings:]
                        )
                        if b in self._speaker_names and a not in self._speaker_names:
                            self._speaker_names[a] = self._speaker_names.pop(b)
                        else:
                            self._speaker_names.pop(b, None)
                        print(f"[diarizer] merge: {b} → {a} (sim={max_sim:.3f})", flush=True)
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
            speaker = _find_speaker(seg.started_at_ms, seg.ended_at_ms, diarization)
            if speaker is not None:
                seg.speaker_label = speaker
        return segments


def make_meeting_diarizer(meeting_id: int, pipeline: Any, **kwargs) -> SpeakerDiarizer:
    db_path = _DEFAULT_DB_DIR / f"meeting_{meeting_id}.json"
    return SpeakerDiarizer(db_path=db_path, pipeline=pipeline, **kwargs)


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
