"""speakrs 화자분리 브릿지.

speakrs(Rust/CoreML)로 빌드한 speakrs-cli 바이너리를 subprocess로 호출해
전체 오디오의 화자 턴을 얻는다. pyannote 대체(엔진 단일화).

바이너리 경로: SPEAKRS_BIN 환경변수 우선, 없으면 sidecar/bin/speakrs-cli.
입력: PCM 16kHz mono Int16. 출력 JSON: {speakers:[...], turns:[{start_ms,end_ms,speaker}]}.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_BIN = Path(__file__).resolve().parents[2] / "bin" / "speakrs-cli"


def _bin_path() -> Path:
    return Path(os.environ.get("SPEAKRS_BIN") or _DEFAULT_BIN)


def is_available() -> bool:
    """speakrs-cli 바이너리가 실행 가능한지 확인."""
    p = _bin_path()
    return p.is_file() and os.access(p, os.X_OK)


def run_speakrs(audio_bytes: bytes) -> tuple[list[tuple[int, int, str]], list[str]]:
    """PCM 16k mono Int16 → (turns, ordered_labels).

    turns: [(start_ms, end_ms, '화자 N'), ...]
    ordered_labels: ['화자 1', '화자 2', ...] (등장순)
    실패 시 ([], []) 반환.
    """
    binp = _bin_path()
    if not binp.is_file():
        raise FileNotFoundError(f"speakrs-cli 바이너리 없음: {binp}")

    with tempfile.NamedTemporaryFile(suffix=".pcm", delete=False) as tf:
        tf.write(audio_bytes)
        pcm_path = tf.name

    try:
        proc = subprocess.run(
            [str(binp), pcm_path],
            capture_output=True,
            timeout=600,
        )
        if proc.returncode != 0:
            logger.error("[speakrs] 비정상 종료(%d): %s", proc.returncode,
                         proc.stderr.decode("utf-8", "ignore")[-500:])
            return [], []
        # stderr엔 타이밍 로그
        for line in proc.stderr.decode("utf-8", "ignore").splitlines():
            if line.startswith("[speakrs-cli]"):
                logger.info(line)
        data = json.loads(proc.stdout.decode("utf-8"))
    finally:
        try:
            os.unlink(pcm_path)
        except OSError:
            pass

    turns = [
        (int(t["start_ms"]), int(t["end_ms"]), str(t["speaker"]))
        for t in data.get("turns", [])
    ]
    labels = [str(s) for s in data.get("speakers", [])]
    return turns, labels
