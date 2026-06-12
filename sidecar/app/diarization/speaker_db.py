"""화자 임베딩 DB — 매칭 상태(embeddings/names/next_num)의 보관 및 JSON 영속화.

SpeakerDiarizer는 이 객체에 매칭 상태를 위임하고, 매칭 알고리즘만 보유한다.
"""
from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def is_valid_embedding(emb: Any) -> bool:
    """NaN, Inf, 제로 벡터를 거른다."""
    import numpy as np
    if emb is None or not hasattr(emb, '__len__') or len(emb) == 0:
        return False
    if np.any(np.isnan(emb)) or np.any(np.isinf(emb)):
        return False
    if np.linalg.norm(emb) < 1e-6:
        return False
    return True


class SpeakerDB:
    """화자 임베딩/이름/번호를 보관하고 JSON 파일에 영속화한다.

    - embeddings: {speaker_id: [emb0, emb1, ...]}  (각 emb는 L2-정규화된 np.ndarray)
    - names: {speaker_id: 표시이름}
    - next_num: 다음 신규 화자 번호
    """

    def __init__(self, db_path: Path | None) -> None:
        self.path = db_path
        self.embeddings: dict[str, list] = {}
        self.names: dict[str, str] = {}
        self.next_num: int = 1

    def load(self) -> None:
        """저장 파일에서 상태를 복원한다 (파일이 없거나 실패 시 그대로 둠)."""
        import numpy as np

        if not self.path or not self.path.exists():
            return
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            next_num = data.get("next_num", 1)
            names = data.get("names", {})
            embeddings: dict[str, list] = {}
            for label, emb_list in data.get("speakers", {}).items():
                if isinstance(emb_list, list):
                    raw_embs = [
                        np.frombuffer(base64.b64decode(b64), dtype=np.float32).copy()
                        for b64 in emb_list
                    ]
                else:
                    raw = base64.b64decode(emb_list)
                    raw_embs = [np.frombuffer(raw, dtype=np.float32).copy()]
                # 오염된 embedding 필터링 — 빈 리스트라도 화자 키는 유지
                # (배치 diarization은 embedding 없는 화자를 빈 리스트로 등록함)
                valid_embs = [e for e in raw_embs if is_valid_embedding(e)]
                embeddings[label] = valid_embs
            # speakers에 없는 화자의 이름은 제거
            valid_ids = set(embeddings.keys())
            self.next_num = next_num
            self.embeddings = embeddings
            self.names = {k: v for k, v in names.items() if k in valid_ids}
            logger.info(f"[diarizer] 화자 DB 로드: {len(self.embeddings)}명 복원 ({self.path})")
        except Exception as e:
            logger.exception(f"[diarizer] 화자 DB 로드 실패 (빈 DB로 시작): {e}")

    def save(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            speakers = {
                label: [
                    base64.b64encode(emb.astype("float32").tobytes()).decode()
                    for emb in emb_list
                ]
                for label, emb_list in self.embeddings.items()
            }
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(
                    {"next_num": self.next_num, "speakers": speakers, "names": self.names},
                    f,
                    ensure_ascii=False,
                )
        except Exception as e:
            logger.exception(f"[diarizer] 화자 DB 저장 실패: {e}")

    def reset(self) -> None:
        """메모리 상태와 저장 파일을 모두 초기화한다."""
        self.embeddings.clear()
        self.names.clear()
        self.next_num = 1
        if self.path and self.path.exists():
            self.path.unlink()
