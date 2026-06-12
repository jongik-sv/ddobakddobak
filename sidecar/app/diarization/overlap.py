"""화자 구간(diarization)과 세그먼트 시간의 최대 겹침으로 화자를 고른다."""
from __future__ import annotations


def find_speaker_by_overlap(
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


def assign_speaker_summed(
    start_ms: int,
    end_ms: int,
    turns: list[tuple[int, int, str]],
) -> str | None:
    """화자별 겹침 합산 argmax. 겹침이 없으면 최근접 턴의 화자.

    turns: [(turn_start_ms, turn_end_ms, speaker), ...]
    (dict 키가 아닌 list라 동일 구간 중복 화자(겹침 발화)도 표현 가능)
    """
    if not turns:
        return None

    totals: dict[str, int] = {}
    for t_start, t_end, speaker in turns:
        overlap = max(0, min(end_ms, t_end) - max(start_ms, t_start))
        if overlap > 0:
            totals[speaker] = totals.get(speaker, 0) + overlap
    if totals:
        return max(totals, key=totals.get)

    # 겹침 없음 → 세그먼트 중심과 턴 중심의 거리가 최소인 턴
    center = (start_ms + end_ms) / 2
    nearest = min(turns, key=lambda t: abs((t[0] + t[1]) / 2 - center))
    return nearest[2]
