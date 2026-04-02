"""STT 어댑터 공통 유틸리티.

환각 판별, PCM 변환 등 모든 STT 어댑터가 공유하는 로직을 모은다.
"""
from __future__ import annotations

import re

import numpy as np

# 의미 있는 최소 글자 수 — 이보다 짧으면 환각으로 간주
MIN_MEANINGFUL_CHARS = 3
_PUNCT_RE = re.compile(r'[\s\.,!?~\-\'"()]')

# 언어별 문자 범위 (환각 판별용)
_LANG_CHAR_RANGES: dict[str, tuple[int, int]] = {
    "ko": (0xAC00, 0xD7A3),  # 한글 음절
    "ja": (0x3040, 0x30FF),  # 히라가나 + 카타카나
    "zh": (0x4E00, 0x9FFF),  # CJK 통합 한자
    "en": (0x0041, 0x007A),  # ASCII 영문자
}


def is_hallucination(text: str, languages: list[str] | None = None) -> bool:
    """짧은 환각성 텍스트 여부 판별.

    대상 언어의 문자가 최소 개수 미만이거나 공백/구두점만 남으면 환각으로 간주한다.
    """
    stripped = _PUNCT_RE.sub("", text.strip())
    if not stripped:
        return True
    target_langs = languages or ["ko"]
    lang_chars = 0
    for lang in target_langs:
        char_range = _LANG_CHAR_RANGES.get(lang)
        if char_range:
            lo, hi = char_range
            lang_chars += sum(1 for c in stripped if lo <= ord(c) <= hi)
    if 0 < lang_chars < MIN_MEANINGFUL_CHARS:
        return True
    return False


def pcm_bytes_to_float32(audio_bytes: bytes) -> np.ndarray:
    """PCM Int16 bytes를 float32 numpy 배열로 변환한다 (범위: -1.0 ~ 1.0)."""
    return np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
