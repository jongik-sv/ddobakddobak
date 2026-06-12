"""화자 분리 파이프라인용 torch 디바이스 선택.

MPS(Apple Silicon GPU) 우선, 불가 시 CPU.
DIARIZATION_DEVICE 환경변수로 강제 가능 (MPS 이슈 발생 시 탈출구).
"""
from __future__ import annotations

import os


def pick_device():
    import torch

    forced = os.environ.get("DIARIZATION_DEVICE", "").strip().lower()
    if forced in ("cpu", "mps"):
        return torch.device(forced)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")
