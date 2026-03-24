"""한국어 문장 분리 후처리 모듈.

Whisper STT 세그먼트를 한국어 문장 종결 패턴 기반으로
병합/분할하여 정교한 문장 단위 세그먼트를 생성한다.
"""
from __future__ import annotations

import re
from copy import deepcopy

from app.stt.base import TranscriptSegment

# 한국어 문장 종결 패턴 (서술/의문/감탄/명령/청유 등)
_SENTENCE_ENDING_RE = re.compile(
    r"(?:"
    r"습니다|ㅂ니다|합니다|됩니다|입니다|었습니다|겠습니다"
    r"|에요|이에요|예요"
    r"|세요|으세요|하세요"
    r"|네요|는데요|거든요|잖아요|군요|대요|래요|나요|가요|던데요"
    r"|죠|지요"
    r"|다|까|요|야|해|지|게|나|라|자"
    r")"
    r"[.!?…]*\s*$"
)

# 문장 내부 분할용: 종결 패턴 + 공백 뒤에 다음 문장 시작
_SPLIT_RE = re.compile(
    r"(?:"
    r"습니다|ㅂ니다|합니다|됩니다|입니다|었습니다|겠습니다"
    r"|에요|이에요|예요"
    r"|세요|으세요|하세요"
    r"|네요|는데요|거든요|잖아요|군요|대요|래요|나요|가요|던데요"
    r"|죠|지요"
    r"|다|까|요|야|해|지|게|나|라|자"
    r")"
    r"[.!?…]*\s+"
)

# 구두점으로 끝나는 경우도 문장 종결로 인식
_PUNCT_ENDING_RE = re.compile(r"[.!?…]\s*$")


def _ends_with_sentence(text: str) -> bool:
    """텍스트가 한국어 문장 종결로 끝나는지 판별."""
    text = text.rstrip()
    if not text:
        return False
    if _PUNCT_ENDING_RE.search(text):
        return True
    if _SENTENCE_ENDING_RE.search(text):
        return True
    return False


def _interpolate_ms(start_ms: int, end_ms: int, ratio: float) -> int:
    """타임스탬프를 비율로 보간."""
    return start_ms + int((end_ms - start_ms) * ratio)


def segment_korean_sentences(
    segments: list[TranscriptSegment],
    max_segment_chars: int = 200,
) -> list[TranscriptSegment]:
    """Whisper 세그먼트를 한국어 문장 단위로 병합/분할한다.

    Phase 1: 문장 종결이 아닌 세그먼트를 다음 세그먼트와 병합
    Phase 2: 200자 초과 세그먼트를 문장 경계에서 분할
    Phase 3: 빈 세그먼트 제거 및 시간순 정렬

    Args:
        segments: Whisper에서 반환된 TranscriptSegment 리스트
        max_segment_chars: 분할 기준 최대 글자 수

    Returns:
        정교하게 분리된 TranscriptSegment 리스트
    """
    if not segments:
        return []

    # Phase 1: 병합 — 문장 종결이 아닌 세그먼트를 다음과 합침
    merged: list[TranscriptSegment] = []
    buffer: TranscriptSegment | None = None

    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue

        if buffer is None:
            buffer = TranscriptSegment(
                text=text,
                started_at_ms=seg.started_at_ms,
                ended_at_ms=seg.ended_at_ms,
                language=seg.language,
                confidence=seg.confidence,
                speaker_label=seg.speaker_label,
            )
        else:
            # 화자가 다르면 현재 버퍼를 flush하고 새 버퍼 시작
            if (
                seg.speaker_label is not None
                and buffer.speaker_label is not None
                and seg.speaker_label != buffer.speaker_label
            ):
                merged.append(buffer)
                buffer = TranscriptSegment(
                    text=text,
                    started_at_ms=seg.started_at_ms,
                    ended_at_ms=seg.ended_at_ms,
                    language=seg.language,
                    confidence=seg.confidence,
                    speaker_label=seg.speaker_label,
                )
                continue

            # 같은 화자거나 화자 미지정 → 병합
            buffer.text = buffer.text + " " + text
            buffer.ended_at_ms = seg.ended_at_ms

        # 문장 종결이면 flush
        if _ends_with_sentence(buffer.text):
            merged.append(buffer)
            buffer = None

    # 남은 버퍼 flush
    if buffer is not None:
        merged.append(buffer)

    # Phase 2: 분할 — 너무 긴 세그먼트를 문장 경계에서 나눔
    split_results: list[TranscriptSegment] = []
    for seg in merged:
        if len(seg.text) <= max_segment_chars:
            split_results.append(seg)
            continue

        # 문장 종결 패턴으로 분할 지점 찾기
        parts: list[str] = []
        last_end = 0
        for match in _SPLIT_RE.finditer(seg.text):
            split_pos = match.end()
            if split_pos < len(seg.text):  # 끝이 아닌 경우만
                parts.append(seg.text[last_end:split_pos].strip())
                last_end = split_pos

        # 나머지 텍스트
        remaining = seg.text[last_end:].strip()
        if remaining:
            parts.append(remaining)

        if len(parts) <= 1:
            # 분할 지점을 찾지 못함 → 그대로 유지
            split_results.append(seg)
            continue

        # 각 파트에 타임스탬프 보간
        total_chars = sum(len(p) for p in parts)
        char_cursor = 0
        for part in parts:
            if not part:
                continue
            ratio_start = char_cursor / total_chars
            char_cursor += len(part)
            ratio_end = char_cursor / total_chars

            split_results.append(TranscriptSegment(
                text=part,
                started_at_ms=_interpolate_ms(seg.started_at_ms, seg.ended_at_ms, ratio_start),
                ended_at_ms=_interpolate_ms(seg.started_at_ms, seg.ended_at_ms, ratio_end),
                language=seg.language,
                confidence=seg.confidence,
                speaker_label=seg.speaker_label,
            ))

    # Phase 3: 정리 — 빈 세그먼트 제거, 시간순 정렬
    result = [s for s in split_results if s.text.strip()]
    result.sort(key=lambda s: s.started_at_ms)
    return result
