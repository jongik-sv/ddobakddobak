"""화자 임베딩 DB 영속화(JSON) 및 임베딩 유효성 검증.

SpeakerDiarizer의 매칭 상태(embeddings/names/next_num)를 디스크에 저장/복원하는
순수 저장소. 매칭 알고리즘은 SpeakerDiarizer가 보유한다.
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
    """화자 임베딩/이름/번호를 JSON 파일에 영속화한다."""

    def __init__(self, db_path: Path | None) -> None:
        self.path = db_path

    def load(self) -> tuple[int, dict[str, str], dict[str, list]] | None:
        """저장된 (next_num, names, embeddings)를 복원한다. 파일이 없거나 실패 시 None."""
        import numpy as np

        if not self.path or not self.path.exists():
            return None
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
                # 오염된 embedding 필터링
                valid_embs = [e for e in raw_embs if is_valid_embedding(e)]
                if valid_embs:
                    embeddings[label] = valid_embs
            # embedding이 없는 화자의 이름도 제거
            valid_ids = set(embeddings.keys())
            names = {k: v for k, v in names.items() if k in valid_ids}
            logger.info(f"[diarizer] 화자 DB 로드: {len(embeddings)}명 복원 ({self.path})")
            return next_num, names, embeddings
        except Exception as e:
            logger.exception(f"[diarizer] 화자 DB 로드 실패 (빈 DB로 시작): {e}")
            return None

    def save(self, next_num: int, names: dict[str, str], embeddings: dict[str, list]) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            speakers = {
                label: [
                    base64.b64encode(emb.astype("float32").tobytes()).decode()
                    for emb in emb_list
                ]
                for label, emb_list in embeddings.items()
            }
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(
                    {"next_num": next_num, "speakers": speakers, "names": names},
                    f,
                    ensure_ascii=False,
                )
        except Exception as e:
            logger.exception(f"[diarizer] 화자 DB 저장 실패: {e}")

    def delete(self) -> None:
        if self.path and self.path.exists():
            self.path.unlink()
