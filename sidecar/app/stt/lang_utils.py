"""STT 언어 코드 변환 및 감지언어 필터 공용 유틸.

- 설정/프론트는 ISO 639-1 코드(ko, en, ja, zh ...)를 사용한다.
- Whisper 계열 엔진은 ISO 코드를 그대로 받는다.
- Qwen3-ASR은 언어 지정 시 영어 풀네임(Korean, Chinese ...)을 기대한다.
"""
from __future__ import annotations

# config.yaml LANGUAGES 코드 ↔ Qwen3 support_languages 풀네임
ISO_TO_QWEN: dict[str, str] = {
    "ko": "Korean",
    "en": "English",
    "ja": "Japanese",
    "zh": "Chinese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "th": "Thai",
    "vi": "Vietnamese",
}
QWEN_TO_ISO: dict[str, str] = {v.lower(): k for k, v in ISO_TO_QWEN.items()}

_DEFAULT_SINGLE_ISO = "ko"


def qwen_force_lang(languages: list[str] | None, mode: str) -> str | None:
    """Qwen 엔진에 넘길 언어값. single이면 풀네임, 그 외 None(자동감지)."""
    if mode != "single" or not languages:
        return None
    return ISO_TO_QWEN.get(languages[0], "Korean")


def iso_force_lang(languages: list[str] | None, mode: str) -> str | None:
    """Whisper 계열 엔진에 넘길 언어값. single이면 ISO 코드, 그 외 None."""
    if mode != "single" or not languages:
        return None
    return languages[0]


def normalize_to_iso(label: str | None) -> str:
    """감지언어 라벨(풀네임 'Korean' 또는 ISO 'ko')을 ISO 코드로 정규화."""
    if not label:
        return ""
    low = label.lower()
    return QWEN_TO_ISO.get(low, low)


def filter_segments(segments, languages: list[str] | None):
    """multi 모드 필터: 감지언어가 허용 목록(ISO)에 없는 세그먼트를 버린다.

    허용 목록이 비어 있으면 전부 통과(필터 비활성).
    """
    allowed = {c.lower() for c in (languages or [])}
    if not allowed:
        return segments
    return [s for s in segments if normalize_to_iso(getattr(s, "language", "")) in allowed]
