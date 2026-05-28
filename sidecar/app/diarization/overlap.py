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
