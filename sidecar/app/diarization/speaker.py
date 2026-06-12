"""화자 DB 디렉터리 헬퍼.

화자 분리 엔진은 speakrs(CoreML 바이너리)로 단일화되었다. 이 모듈은 회의별
SpeakerDB JSON이 저장되는 디렉터리 경로를 결정하는 헬퍼만 보유한다.
"""
from __future__ import annotations

from pathlib import Path


# 회의별 DB 저장 디렉터리: SPEAKER_DBS_DIR 환경변수 또는 sidecar/speaker_dbs/
def _get_db_dir() -> Path:
    from app.config import settings
    if settings.SPEAKER_DBS_DIR:
        return Path(settings.SPEAKER_DBS_DIR)
    return Path(__file__).parent.parent.parent / "speaker_dbs"
