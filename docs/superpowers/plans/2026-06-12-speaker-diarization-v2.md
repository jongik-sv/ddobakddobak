# Speaker Diarization v2 (pyannote community-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화자 분리를 "청크 단위 실시간(품질 문제로 OFF)" 구조에서 "회의 종료/파일 업로드 후 전체 오디오 배치 1회" 구조로 재설계하고, 모델을 pyannote 3.1(CPU)에서 community-1(MPS)로 업그레이드한다.

**Architecture:** 실시간 경로는 화자 라벨 없이 동작 유지(기본 OFF 그대로). 배치 경로(`/transcribe-file`)에서 WhisperX 재전사를 폐기하고, 기존 STT 결과 + community-1 전체 파일 diarization + 화자별 겹침 합산(argmax) 병합으로 교체. 배치 결과 화자 embedding을 회의별 SpeakerDB에 등록해 rename/reset API가 배치 결과에도 동작하게 한다. Rails는 ENV 대신 settings.yaml에서 diarization 설정을 읽는다. 기존 `regenerate_stt` 액션이 "완료된 회의 재분석" 트리거로 그대로 쓰인다.

**Tech Stack:** pyannote-audio 4.0.4 (`pyannote/speaker-diarization-community-1`, CC-BY-4.0, HF gated), PyTorch MPS, FastAPI sidecar (Python 3.11, uv), Rails 8 backend, React/Tauri frontend.

**리서치 근거:** `docs/diarization-research-2026-06.md` (2026-06-12 멀티에이전트 리서치 + 적대적 검증). 핵심: community-1은 3.1 대비 11/12 벤치마크 개선(AMI-SDM 22.7→19.9%), MPS ~24-40x RT, 단 OSS는 배치 전용. 짧은 청크(2-8s) 실시간 분리는 어떤 엔진이든 DER 20-50%로 열세 → 배치 중심 재설계.

---

## 사전 확인 (코드 작성 전, 수동)

- [ ] **브랜치 확인**: `git branch --show-current` → `feat/speaker-diarization` (이미 생성됨. main에서 분기, 2026-06-12)
- [ ] **HF gated 모델 라이선스 수락**: 브라우저로 https://huggingface.co/pyannote/speaker-diarization-community-1 접속 → settings.yaml의 `hf.token` 계정으로 로그인 → "Agree and access" 클릭. **이거 안 하면 모델 다운로드 401.**
- [ ] **의존성 확인**: `cd sidecar && uv sync --extra macos` — pyproject.toml에 `pyannote-audio>=4.0.4` 이미 있음 (코드만 구세대 3.1 모델 사용 중)
- [ ] **모델 다운로드 + MPS 스모크 테스트** (1회, ~분 단위):
  ```bash
  cd sidecar && uv run python -c "
  import torch
  from pyannote.audio import Pipeline
  import yaml
  token = yaml.safe_load(open('../settings.yaml'))['hf']['token']
  p = Pipeline.from_pretrained('pyannote/speaker-diarization-community-1', token=token)
  p.to(torch.device('mps'))
  print('OK: pipeline loaded on MPS')
  "
  ```
  Expected: `OK: pipeline loaded on MPS`. 실패 시 라이선스 수락 여부/토큰 확인.

---

## 현재 구조 요약 (집에서 컨텍스트 제로로 시작하는 사람용)

**sidecar (Python FastAPI, `sidecar/app/`)** — STT 엔진은 qwen3_asr_8bit(MLX). 파일 전사는 WhisperAdapter(pywhispercpp) 사용:
- `routers/stt.py:35` `/transcribe` — 실시간 청크(2-8s) STT. 62-79행에서 diarizer 호출 (현재 settings로 OFF)
- `routers/stt.py:87` `/transcribe-file` — 파일 전체 STT. 152-171행: WhisperX 시도 → 실패 시 `batch_diarize` 폴백. **WhisperX는 Whisper로 재전사해서 STT가 2번 돔 (폐기 대상)**
- `diarization/speaker.py` — 청크 단위 diarizer. `_PIPELINE_MODEL = "pyannote/speaker-diarization-3.1"` (31행), `pipeline.to(torch.device("cpu"))` (114행)
- `diarization/batch_processor.py` — 전체 파일 pyannote 실행 + 세그먼트 화자 할당
- `diarization/overlap.py` — `find_speaker_by_overlap`: dict[(start,end)→speaker]에서 최대 겹침 1턴 선택 (화자별 합산 아님, 무겹침 시 None)
- `diarization/speaker_db.py` — 회의별 embedding/이름 JSON 영속화 (`sidecar/speaker_dbs/meeting_<id>.json`)
- `diarization/whisperx_processor.py` — **삭제 대상**
- `deps.py:19` `ensure_diarizer_pipeline` (lazy load), `deps.py:42` `get_meeting_diarizer`
- `routers/speakers.py` — GET/PUT/DELETE /speakers. **pipeline 미로드면 503/빈 목록 → 배치 결과와 분리돼 있던 갭**

**backend (Rails)**:
- `app/jobs/file_transcription_job.rb` — ffmpeg→PCM, sidecar `/transcribe-file` 호출, Transcript 일괄 생성. 19행: `DIARIZATION_ENABLED` **ENV에서 읽음 (settings.yaml 무시 — 수정 대상)**. 97행 fallback `"화자 1"`
- `app/jobs/transcription_job.rb:28` — 실시간 fallback `"SPEAKER_00"` (**"화자 1"로 통일 대상**)
- `app/controllers/api/v1/meetings_controller.rb:229` `regenerate_stt` — 완료된 회의 재전사 트리거 (transcripts purge 후 FileTranscriptionJob). **배치 화자분석 진입점으로 재사용**
- `app/controllers/api/v1/settings_controller.rb:159-238` — settings.yaml(루트 `settings.yaml`)의 diarization 섹션 read/write (`load_settings`/`save_settings`)

**frontend**:
- `src/components/settings/DiarizationPanel.tsx` — enabled 토글 + threshold 슬라이더 (Rails PUT /settings/app 경유)
- `src/components/meeting/SpeakerLabel.tsx:14` — `speakerColor`: 라벨 끝 숫자로 색상 (이미 "화자 N" 호환)
- `src/channels/transcription.ts:86` — fallback `'SPEAKER_00'` (**"화자 1"로 통일 대상**)

**설정 파일**: 루트 `settings.yaml` (런타임, gitignore 추정) + 루트 `config.yaml` (기본값 템플릿). diarization 블록: enabled/similarity_threshold/merge_threshold/max_embeddings_per_speaker.

**테스트**: `cd sidecar && uv run pytest tests/ -v` (fake pipeline 기반 기존 테스트: test_speaker_diarization.py, test_speaker_db.py, test_overlap.py, test_speaker_matching.py). Rails: `cd backend && bundle exec rspec`.

---

### Task 1: 디바이스 선택 헬퍼 (MPS 우선, CPU 폴백)

**Files:**
- Create: `sidecar/app/diarization/device.py`
- Test: `sidecar/tests/test_device.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# sidecar/tests/test_device.py
"""pick_device 단위 테스트 — torch 가용성에 따른 디바이스 선택."""
from unittest.mock import patch

from app.diarization.device import pick_device


def test_pick_device_prefers_mps_when_available():
    with patch("torch.backends.mps.is_available", return_value=True):
        assert str(pick_device()) == "mps"


def test_pick_device_falls_back_to_cpu():
    with patch("torch.backends.mps.is_available", return_value=False):
        assert str(pick_device()) == "cpu"


def test_pick_device_env_override_forces_cpu(monkeypatch):
    monkeypatch.setenv("DIARIZATION_DEVICE", "cpu")
    with patch("torch.backends.mps.is_available", return_value=True):
        assert str(pick_device()) == "cpu"
```

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_device.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.diarization.device'`

- [ ] **Step 3: 구현**

```python
# sidecar/app/diarization/device.py
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_device.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/diarization/device.py sidecar/tests/test_device.py
git commit -m "feat(diarization): add MPS-first device picker with env override"
```

---

### Task 2: 모델 업그레이드 — community-1 + MPS

**Files:**
- Modify: `sidecar/app/diarization/speaker.py:31` (모델명), `speaker.py:110-117` (`_load` 내부 디바이스)

- [ ] **Step 1: 모델명 교체**

`sidecar/app/diarization/speaker.py` 31행:

```python
# 변경 전
_PIPELINE_MODEL = "pyannote/speaker-diarization-3.1"
# 변경 후
_PIPELINE_MODEL = "pyannote/speaker-diarization-community-1"
```

- [ ] **Step 2: 디바이스 교체**

`speaker.py` `load()` 내부 `_load()` (110-117행):

```python
        def _load():
            import os
            os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
            from app.diarization.device import pick_device
            pipeline = Pipeline.from_pretrained(_PIPELINE_MODEL, token=hf_token or None)
            device = pick_device()
            pipeline.to(device)
            logger.info(f"[diarizer] pipeline loaded: {_PIPELINE_MODEL} on {device}")
            if hasattr(pipeline, "num_workers"):
                pipeline.num_workers = 0
            return pipeline
```

- [ ] **Step 3: 기존 테스트 회귀 확인**

Run: `cd sidecar && uv run pytest tests/ -v -k "speaker or overlap"`
Expected: 전부 PASS (기존 테스트는 fake pipeline 주입이라 모델명 변경 무관. 실패하면 테스트가 "3.1" 문자열을 단언하는지 확인 후 community-1로 갱신)

- [ ] **Step 4: Commit**

```bash
git add sidecar/app/diarization/speaker.py
git commit -m "feat(diarization): upgrade to community-1 pipeline on MPS"
```

---

### Task 3: 화자 할당 개선 — 화자별 겹침 합산 argmax + 최근접 폴백

현재 `find_speaker_by_overlap`은 "가장 긴 단일 턴"만 보고, 겹침 0이면 None(라벨 누락 → Rails fallback "화자 1"로 오귀속). WhisperX `assign_word_speakers` 방식으로 교체: 세그먼트와 겹치는 모든 턴을 **화자별로 합산**해 argmax, 겹침 없으면 **최근접 턴** 화자.

**Files:**
- Modify: `sidecar/app/diarization/overlap.py` (함수 추가 — 기존 `find_speaker_by_overlap`는 실시간 경로가 쓰므로 유지)
- Test: `sidecar/tests/test_overlap.py` (추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `sidecar/tests/test_overlap.py`에 append:

```python
from app.diarization.overlap import assign_speaker_summed


def test_summed_overlap_beats_single_longest_turn():
    # 화자1: 0-400 + 600-1000 (합산 800ms) vs 화자2: 400-600 (200ms)
    # 기존 find_speaker_by_overlap는 "최장 단일 턴"만 봐서 이런 케이스에 약함
    turns = [(0, 400, "화자 1"), (400, 600, "화자 2"), (600, 1000, "화자 1")]
    assert assign_speaker_summed(0, 1000, turns) == "화자 1"


def test_no_overlap_falls_back_to_nearest_turn():
    turns = [(0, 500, "화자 1"), (5000, 6000, "화자 2")]
    # 세그먼트 4000-4500: 겹침 0, 화자2 턴(5000)이 화자1 턴 끝(500)보다 가까움
    assert assign_speaker_summed(4000, 4500, turns) == "화자 2"


def test_empty_turns_returns_none():
    assert assign_speaker_summed(0, 1000, []) is None


def test_duplicate_intervals_do_not_collide():
    # dict 키 충돌 없는 list[tuple] 입력 — 같은 (start,end)에 두 화자 가능(겹침 발화)
    turns = [(0, 1000, "화자 1"), (0, 1000, "화자 2"), (0, 300, "화자 2")]
    # 화자2 합산 1300 > 화자1 1000 → 화자 2
    assert assign_speaker_summed(0, 1000, turns) == "화자 2"
```

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_overlap.py -v`
Expected: FAIL — `ImportError: cannot import name 'assign_speaker_summed'`

- [ ] **Step 3: 구현** — `sidecar/app/diarization/overlap.py`에 append:

```python
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_overlap.py -v`
Expected: 신규 4개 포함 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/diarization/overlap.py sidecar/tests/test_overlap.py
git commit -m "feat(diarization): summed-overlap argmax speaker assignment with nearest fallback"
```

---

### Task 4: batch_processor 재구성 — exclusive diarization + SpeakerDB 등록

배치 diarization이 (a) community-1의 `exclusive_speaker_diarization` 출력(STT 정합용 비겹침 타임라인)을 우선 사용, (b) 새 합산 할당 사용, (c) 화자 embedding을 회의별 SpeakerDB에 등록해 rename/reset이 배치 결과에 동작하게 한다.

**Files:**
- Rewrite: `sidecar/app/diarization/batch_processor.py`
- Test: `sidecar/tests/test_batch_processor.py` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# sidecar/tests/test_batch_processor.py
"""batch_diarize 단위 테스트 — fake pyannote pipeline으로 검증."""
import json

import numpy as np
import pytest

from app.diarization.batch_processor import batch_diarize
from app.stt.base import TranscriptSegment


class _FakeTurn:
    def __init__(self, start: float, end: float):
        self.start = start
        self.end = end


class _FakeAnnotation:
    """pyannote Annotation 흉내: itertracks/labels만 구현."""

    def __init__(self, tracks):  # tracks: [(start_s, end_s, label)]
        self._tracks = tracks

    def labels(self):
        seen = []
        for _, _, lab in self._tracks:
            if lab not in seen:
                seen.append(lab)
        return seen

    def itertracks(self, yield_label=False):
        for start, end, lab in self._tracks:
            yield _FakeTurn(start, end), None, lab


class _FakeOutput:
    def __init__(self, tracks, embeddings):
        self.speaker_diarization = _FakeAnnotation(tracks)
        self.exclusive_speaker_diarization = _FakeAnnotation(tracks)
        self.speaker_embeddings = embeddings


class _FakePipeline:
    def __init__(self, tracks, embeddings):
        self._out = _FakeOutput(tracks, embeddings)

    def __call__(self, audio_input):
        return self._out


def _segments():
    return [
        TranscriptSegment(text="안녕하세요", started_at_ms=0, ended_at_ms=2000,
                          language="ko", confidence=0.9),
        TranscriptSegment(text="네 반갑습니다", started_at_ms=2500, ended_at_ms=4500,
                          language="ko", confidence=0.9),
    ]


@pytest.fixture
def audio_bytes():
    # 5초 무음 PCM 16kHz mono Int16
    return b"\x00\x00" * 16000 * 5


async def test_assigns_speakers_from_diarization(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32), -np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(
        tracks=[(0.0, 2.2, "SPEAKER_00"), (2.3, 5.0, "SPEAKER_01")],
        embeddings=emb,
    )
    segments = await batch_diarize(audio_bytes, pipeline, _segments(),
                                   meeting_id=99, db_dir=tmp_path)
    assert segments[0].speaker_label == "화자 1"
    assert segments[1].speaker_label == "화자 2"


async def test_registers_embeddings_in_speaker_db(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32), -np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(
        tracks=[(0.0, 2.2, "SPEAKER_00"), (2.3, 5.0, "SPEAKER_01")],
        embeddings=emb,
    )
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=99, db_dir=tmp_path)
    db_file = tmp_path / "meeting_99.json"
    assert db_file.exists()
    data = json.loads(db_file.read_text())
    assert set(data["speakers"].keys()) == {"화자 1", "화자 2"}


async def test_preserves_existing_speaker_names_on_rerun(audio_bytes, tmp_path):
    emb = np.stack([np.ones(256, dtype=np.float32)])
    pipeline = _FakePipeline(tracks=[(0.0, 5.0, "SPEAKER_00")], embeddings=emb)
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=7, db_dir=tmp_path)
    # 사용자가 이름 부여했다고 가정
    db_file = tmp_path / "meeting_7.json"
    data = json.loads(db_file.read_text())
    data["names"] = {"화자 1": "김철수"}
    db_file.write_text(json.dumps(data, ensure_ascii=False))
    # 재실행(regenerate_stt 시나리오) — 이름 유지
    await batch_diarize(audio_bytes, pipeline, _segments(), meeting_id=7, db_dir=tmp_path)
    data2 = json.loads(db_file.read_text())
    assert data2["names"].get("화자 1") == "김철수"


async def test_no_embeddings_still_assigns_labels(audio_bytes, tmp_path):
    pipeline = _FakePipeline(tracks=[(0.0, 5.0, "SPEAKER_00")], embeddings=None)
    segments = await batch_diarize(audio_bytes, pipeline, _segments(),
                                   meeting_id=5, db_dir=tmp_path)
    assert segments[0].speaker_label == "화자 1"
```

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_batch_processor.py -v`
Expected: FAIL — `TypeError: batch_diarize() got an unexpected keyword argument 'meeting_id'`

- [ ] **Step 3: 구현** — `sidecar/app/diarization/batch_processor.py` 전체 교체:

```python
"""BatchDiarizer: 전체 오디오에 pyannote 파이프라인을 한 번에 실행하는 배치 화자 분리.

파일 전사(/transcribe-file) 시 사용. 짧은 청크 대신 전체 오디오를 한 번에 처리.
community-1의 exclusive_speaker_diarization(비겹침, STT 정합용)을 우선 사용하고,
화자 embedding을 회의별 SpeakerDB에 등록해 rename/reset API와 연동한다.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.audio_constants import (
    SAMPLE_RATE as _SAMPLE_RATE,
    BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE,
    SEC_TO_MS as _SEC_TO_MS,
)
from app.diarization.overlap import assign_speaker_summed
from app.diarization.speaker_db import SpeakerDB, is_valid_embedding
from app.stt.base import TranscriptSegment

logger = logging.getLogger(__name__)


async def batch_diarize(
    audio_bytes: bytes,
    pipeline: Any,
    segments: list[TranscriptSegment],
    meeting_id: int | None = None,
    db_dir: Path | None = None,
) -> list[TranscriptSegment]:
    """전체 오디오 diarization 후 STT 세그먼트에 화자를 할당한다.

    meeting_id가 있으면 화자 embedding을 SpeakerDB(meeting_<id>.json)에 등록해
    rename/reset API가 동작하게 한다. 재실행 시 기존 화자 이름(names)은 유지.
    """
    if not segments or len(audio_bytes) < _SAMPLE_RATE * _BYTES_PER_SAMPLE:
        return segments

    loop = asyncio.get_running_loop()
    turns, embeddings, ordered_labels = await loop.run_in_executor(
        None, _run_full_pipeline, audio_bytes, pipeline
    )

    if not turns:
        return segments

    for seg in segments:
        speaker = assign_speaker_summed(seg.started_at_ms, seg.ended_at_ms, turns)
        if speaker:
            seg.speaker_label = speaker

    if meeting_id is not None:
        _register_speakers(meeting_id, ordered_labels, embeddings, db_dir)

    return segments


def _run_full_pipeline(
    audio_bytes: bytes,
    pipeline: Any,
) -> tuple[list[tuple[int, int, str]], Any, list[str]]:
    """pyannote 파이프라인 실행 → (turns, embeddings, '화자 N' 순서 라벨)."""
    import torch

    from app.stt.audio_utils import pcm_bytes_to_float32

    audio_array = pcm_bytes_to_float32(audio_bytes)
    duration_sec = len(audio_array) / _SAMPLE_RATE
    logger.info(f"[batch-diarizer] 전체 오디오 처리: {duration_sec:.1f}초")

    waveform = torch.from_numpy(audio_array).unsqueeze(0)
    audio_input = {"waveform": waveform, "sample_rate": _SAMPLE_RATE}

    output = pipeline(audio_input)
    # community-1: exclusive_speaker_diarization = 비겹침 타임라인 (STT 정합 전용 설계)
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = output.speaker_diarization
    embeddings = getattr(output, "speaker_embeddings", None)

    # 라벨 정렬: speaker_diarization.labels() 순서 = embeddings 행 순서 (pyannote 보장)
    raw_labels = output.speaker_diarization.labels()
    label_map = {label: f"화자 {i + 1}" for i, label in enumerate(raw_labels)}
    ordered_labels = [label_map[label] for label in raw_labels]

    turns: list[tuple[int, int, str]] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        turns.append((
            int(turn.start * _SEC_TO_MS),
            int(turn.end * _SEC_TO_MS),
            label_map.get(speaker, "화자 1"),
        ))

    logger.info(f"[batch-diarizer] 완료: {len(raw_labels)}명 화자, {len(turns)}개 구간")
    return turns, embeddings, ordered_labels


def _register_speakers(
    meeting_id: int,
    ordered_labels: list[str],
    embeddings: Any,
    db_dir: Path | None = None,
) -> None:
    """배치 결과 화자를 SpeakerDB에 등록한다 (rename/reset API 연동).

    배치 결과가 항상 최종본이므로 embedding은 전부 교체하되,
    사용자가 부여한 이름(names)은 같은 '화자 N' 키로 유지한다.
    """
    import numpy as np

    if db_dir is None:
        from app.diarization.speaker import _get_db_dir
        db_dir = _get_db_dir()
    db = SpeakerDB(Path(db_dir) / f"meeting_{meeting_id}.json")
    db.load()
    old_names = dict(db.names)

    db.embeddings = {}
    for i, label in enumerate(ordered_labels):
        if embeddings is not None and i < len(embeddings):
            emb = np.asarray(embeddings[i], dtype=np.float32)
            if is_valid_embedding(emb):
                norm = np.linalg.norm(emb)
                db.embeddings[label] = [emb / norm]
                continue
        db.embeddings[label] = []  # embedding 없어도 rename 가능하도록 키는 유지
    db.names = {k: v for k, v in old_names.items() if k in db.embeddings}
    db.next_num = len(ordered_labels) + 1
    db.save()
    logger.info(f"[batch-diarizer] SpeakerDB 등록: meeting={meeting_id}, {len(ordered_labels)}명")
```

**주의**: `SpeakerDB.load()`(speaker_db.py:64-66)는 embedding이 빈 화자를 로드시 제거한다 — embedding 없는 화자(`db.embeddings[label] = []`)는 reload 후 사라질 수 있음. embeddings가 None인 경우는 드물지만(community-1은 항상 반환), 테스트 `test_no_embeddings_still_assigns_labels`는 라벨 할당만 검증하고 DB 영속까지는 요구하지 않는 이유.

- [ ] **Step 4: 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_batch_processor.py -v`
Expected: 4 PASS

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run: `cd sidecar && uv run pytest tests/ -v`
Expected: 전부 PASS (batch_processor의 옛 `find_speaker_by_overlap` 사용 테스트가 있으면 새 시그니처에 맞게 갱신)

- [ ] **Step 6: Commit**

```bash
git add sidecar/app/diarization/batch_processor.py sidecar/tests/test_batch_processor.py
git commit -m "feat(diarization): batch processor uses exclusive timeline + registers SpeakerDB"
```

---

### Task 5: /transcribe-file에서 WhisperX 폐기, 배치 diarization 단일 경로화

**Files:**
- Modify: `sidecar/app/routers/stt.py:152-209` (`_try_whisperx_batch` 삭제, 호출부 교체)
- Delete: `sidecar/app/diarization/whisperx_processor.py`
- Modify: `sidecar/pyproject.toml` (whisperx 의존 제거)
- Delete/Modify: whisperx 관련 테스트 (`grep -rn whisperx sidecar/tests/`로 확인)

- [ ] **Step 1: stt.py 화자 분리 블록 교체**

`sidecar/app/routers/stt.py` 152-171행을 다음으로 교체:

```python
    # 3. 화자 분리 — community-1 전체 오디오 배치 (MPS, gpu_lock으로 MLX와 직렬화)
    enable_diarization = (request.diarization_config or {}).get("enable", False)
    if enable_diarization and segments:
        await ensure_diarizer_pipeline(http_request.app)
        pipeline = getattr(http_request.app.state, "diarizer_pipeline", None)
        if pipeline:
            try:
                from app.diarization.batch_processor import batch_diarize
                async with http_request.app.state.gpu_lock:
                    segments = await batch_diarize(
                        audio_bytes, pipeline, segments,
                        meeting_id=request.meeting_id,
                    )
                logger.info(f"[transcribe-file] 배치 화자 분리 완료")
            except Exception as e:
                logger.exception(f"[transcribe-file] 화자 분리 실패 (무시): {e}")
    else:
        logger.info(f"[transcribe-file] 화자 분리 스킵")
```

- [ ] **Step 2: `_try_whisperx_batch` 함수 전체 삭제** (stt.py 185-209행)

- [ ] **Step 3: 파일/의존성 삭제**

```bash
git rm sidecar/app/diarization/whisperx_processor.py
grep -rn "whisperx" sidecar/app sidecar/tests   # 잔존 참조 0 확인
```

`sidecar/pyproject.toml` macos·cuda extras에서 `"whisperx>=3.3",`과 `"omegaconf>=2.3",` 줄 삭제 (omegaconf는 whisperx 전용이었는지 `grep -rn omegaconf sidecar/app`로 확인 후 — 직접 사용 없으면 삭제):

```bash
cd sidecar && uv sync --extra macos   # lock 갱신
```

- [ ] **Step 4: 전체 테스트 + import 스모크**

Run: `cd sidecar && uv run pytest tests/ -v && uv run python -c "from app.main import app; print('OK')"`
Expected: 전부 PASS + `OK`

- [ ] **Step 5: Commit**

```bash
git add -A sidecar
git commit -m "refactor(stt): drop WhisperX re-transcription; single batch diarization path"
```

---

### Task 6: /speakers API를 SpeakerDB 파일 기반으로 — 배치 결과 rename/reset 동작

현재 `get_meeting_diarizer`는 pipeline 로드 + 메모리 dict 필수 → sidecar 재시작 후나 배치-only 흐름에서 화자 목록이 비거나 503. SpeakerDB JSON을 직접 읽는 방식으로 교체.

**Files:**
- Modify: `sidecar/app/routers/speakers.py` (전체)
- Test: `sidecar/tests/test_speakers_router.py` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# sidecar/tests/test_speakers_router.py
"""/speakers 라우터 — pipeline 없이 SpeakerDB 파일만으로 동작 검증."""
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def speaker_db(tmp_path, monkeypatch):
    monkeypatch.setenv("SPEAKER_DBS_DIR", str(tmp_path))
    # config.settings는 시작 시 캐시될 수 있으므로 직접 패치
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path), raising=False)
    db_file = tmp_path / "meeting_42.json"
    db_file.write_text(json.dumps({
        "next_num": 3,
        "speakers": {"화자 1": [], "화자 2": []},
        "names": {"화자 1": "김철수"},
    }, ensure_ascii=False))
    return db_file


async def test_get_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    speakers = {s["id"]: s["name"] for s in res.json()["speakers"]}
    assert speakers == {"화자 1": "김철수", "화자 2": "화자 2"}


async def test_rename_speaker_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                               json={"name": "이영희"})
    assert res.status_code == 200
    data = json.loads(speaker_db.read_text())
    assert data["names"]["화자 2"] == "이영희"


async def test_reset_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    assert not speaker_db.exists()
```

**참고**: SpeakerDB.load()는 embedding 빈 화자를 거른다(speaker_db.py:64-66) → 위 테스트의 `"speakers": {"화자 1": [], ...}`가 걸러지면 테스트 FAIL. 이 경우 speaker_db.py 64-66행을 "빈 리스트는 유지, 오염된 embedding만 제거"로 수정:

```python
                valid_embs = [e for e in raw_embs if is_valid_embedding(e)]
                embeddings[label] = valid_embs   # 빈 리스트라도 화자 키 유지
            valid_ids = set(embeddings.keys())
```

(기존: `if valid_embs: embeddings[label] = valid_embs` — 화자 자체가 사라짐. Task 4의 "embedding 없는 화자" 케이스와 일관되게 수정.)

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_speakers_router.py -v`
Expected: FAIL (현재는 pipeline 없으면 빈 목록/503)

- [ ] **Step 3: 라우터 재구현** — `sidecar/app/routers/speakers.py` 전체 교체:

```python
"""회의별 화자 관리 라우터 — SpeakerDB JSON 파일 직접 접근 (pipeline 불필요)."""
import urllib.parse

from fastapi import APIRouter, HTTPException, Request

from app.schemas import RenameSpeakerRequest

router = APIRouter()


def _open_db(meeting_id: int):
    from app.diarization.speaker import _get_db_dir
    from app.diarization.speaker_db import SpeakerDB

    db = SpeakerDB(_get_db_dir() / f"meeting_{meeting_id}.json")
    db.load()
    return db


@router.get("/speakers")
async def get_speakers(meeting_id: int, request: Request) -> dict:
    """회의별 등록된 화자 목록을 반환한다."""
    db = _open_db(meeting_id)
    return {"speakers": [
        {"id": label, "name": db.names.get(label, label)}
        for label in db.embeddings
    ]}


@router.put("/speakers/{speaker_id}")
async def rename_speaker(speaker_id: str, meeting_id: int, request: RenameSpeakerRequest, http_request: Request) -> dict:
    """화자에 이름을 부여한다."""
    decoded_id = urllib.parse.unquote(speaker_id)
    db = _open_db(meeting_id)
    if decoded_id not in db.embeddings:
        raise HTTPException(status_code=404, detail=f"화자 '{decoded_id}'를 찾을 수 없습니다.")
    db.names[decoded_id] = request.name
    db.save()
    # 메모리에 살아있는 실시간 diarizer와 동기화
    diarizers = getattr(http_request.app.state, "meeting_diarizers", {})
    if meeting_id in diarizers:
        diarizers[meeting_id].rename_speaker(decoded_id, request.name)
    return {"id": decoded_id, "name": request.name}


@router.delete("/speakers")
async def reset_speakers(meeting_id: int, request: Request) -> dict:
    """회의의 화자 DB를 초기화한다."""
    db = _open_db(meeting_id)
    db.reset()
    # lifespan 미실행(테스트 등)이면 meeting_diarizers가 없을 수 있음
    diarizers = getattr(request.app.state, "meeting_diarizers", None)
    if diarizers is not None:
        diarizers.pop(meeting_id, None)
    return {"ok": True}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `cd sidecar && uv run pytest tests/ -v`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/routers/speakers.py sidecar/app/diarization/speaker_db.py sidecar/tests/test_speakers_router.py
git commit -m "feat(speakers): file-backed speakers API works without loaded pipeline"
```

---

### Task 7: Rails — diarization 설정을 ENV 대신 settings.yaml에서 읽기

FileTranscriptionJob이 `DIARIZATION_ENABLED` ENV(기본 "true")를 읽어 **프론트 토글(settings.yaml)을 무시**한다. SettingsController가 쓰는 동일 파일을 읽도록 수정.

**Files:**
- Create: `backend/app/services/app_settings.rb`
- Modify: `backend/app/jobs/file_transcription_job.rb:18-31`
- Modify: `backend/app/controllers/api/v1/settings_controller.rb` (load_settings를 새 서비스로 위임 — 중복 제거)
- Test: `backend/spec/services/app_settings_spec.rb`

- [ ] **Step 1: settings_controller.rb의 SETTINGS_PATH 상수/로드 방식 확인**

Run: `grep -n "SETTINGS_PATH\|load_settings\|save_settings" backend/app/controllers/api/v1/settings_controller.rb`
(경로 상수명·기본값을 그대로 새 서비스로 옮긴다)

- [ ] **Step 2: 실패하는 테스트 작성**

```ruby
# backend/spec/services/app_settings_spec.rb
require "rails_helper"

RSpec.describe AppSettings do
  let(:yaml) do
    <<~YAML
      diarization:
        enabled: true
        similarity_threshold: 0.5
        merge_threshold: 0.62
        max_embeddings_per_speaker: 12
    YAML
  end

  it "settings.yaml의 diarization 블록을 sidecar diarization_config로 변환한다" do
    allow(File).to receive(:exist?).and_return(true)
    allow(File).to receive(:read).and_return(yaml)
    config = described_class.diarization_config
    expect(config).to eq(
      "enable" => true,
      "similarity_threshold" => 0.5,
      "merge_threshold" => 0.62,
      "max_embeddings_per_speaker" => 12
    )
  end

  it "파일이 없으면 기본값(비활성)을 반환한다" do
    allow(File).to receive(:exist?).and_return(false)
    expect(described_class.diarization_config["enable"]).to eq(false)
  end
end
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/app_settings_spec.rb`
Expected: FAIL — `uninitialized constant AppSettings`

- [ ] **Step 4: 구현**

```ruby
# backend/app/services/app_settings.rb
# settings.yaml(sidecar 공유 런타임 설정) 읽기 헬퍼.
# SettingsController#app_settings 와 같은 파일을 읽는다.
class AppSettings
  # SettingsController와 동일 경로 — Step 1에서 확인한 상수/기본값으로 맞출 것
  SETTINGS_PATH = ENV.fetch("SETTINGS_PATH", Rails.root.join("..", "settings.yaml").to_s)

  DIARIZATION_DEFAULTS = {
    "enable" => false,
    "similarity_threshold" => 0.45,
    "merge_threshold" => 0.6,
    "max_embeddings_per_speaker" => 17
  }.freeze

  def self.load
    return {} unless File.exist?(SETTINGS_PATH)
    YAML.safe_load(File.read(SETTINGS_PATH)) || {}
  rescue => e
    Rails.logger.error "[AppSettings] settings.yaml 로드 실패: #{e.message}"
    {}
  end

  def self.diarization_config
    d = load["diarization"] || {}
    {
      "enable" => d.key?("enabled") ? !!d["enabled"] : DIARIZATION_DEFAULTS["enable"],
      "similarity_threshold" => (d["similarity_threshold"] || DIARIZATION_DEFAULTS["similarity_threshold"]).to_f,
      "merge_threshold" => (d["merge_threshold"] || DIARIZATION_DEFAULTS["merge_threshold"]).to_f,
      "max_embeddings_per_speaker" => (d["max_embeddings_per_speaker"] || DIARIZATION_DEFAULTS["max_embeddings_per_speaker"]).to_i
    }
  end
end
```

**중요**: `SETTINGS_PATH` 기본 경로는 Step 1에서 확인한 SettingsController의 실제 값으로 맞출 것 (위 `Rails.root.join("..", "settings.yaml")`은 추정값).

- [ ] **Step 5: FileTranscriptionJob 수정** — 18-31행 교체:

```ruby
    file_chunk_sec = ENV.fetch("AUDIO_FILE_CHUNK_SEC", "30").to_i
    result = SidecarClient.new.transcribe_file(
      pcm_path,
      meeting_id: meeting.id,
      languages: languages,
      mode: mode,
      file_chunk_sec: file_chunk_sec,
      diarization_config: AppSettings.diarization_config
    )
```

- [ ] **Step 6: 통과 + 회귀 확인**

Run: `cd backend && bundle exec rspec spec/services/app_settings_spec.rb spec/jobs/`
Expected: PASS (file_transcription_job 기존 spec이 ENV stub에 의존하면 AppSettings stub으로 갱신)

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/app_settings.rb backend/app/jobs/file_transcription_job.rb backend/spec
git commit -m "fix(diarization): file transcription reads settings.yaml toggle, not ENV"
```

---

### Task 8: fallback 라벨 통일 — "화자 1"

세 군데가 제각각: file job `"화자 1"` / realtime job `"SPEAKER_00"` / frontend `'SPEAKER_00'`. 전부 `"화자 1"`로 통일 (FTS 검색·표시 일관성).

**Files:**
- Modify: `backend/app/jobs/transcription_job.rb:28`
- Modify: `frontend/src/channels/transcription.ts:86`

- [ ] **Step 1: transcription_job.rb 28행**

```ruby
# 변경 전
speaker = segment.fetch("speaker_label", nil) || segment.fetch("speaker", "SPEAKER_00")
# 변경 후
speaker = segment.fetch("speaker_label", nil) || segment.fetch("speaker", nil) || "화자 1"
```

- [ ] **Step 2: frontend transcription.ts 86행**

```ts
// 변경 전
const speakerLabel = raw.speaker ?? raw.speaker_label ?? 'SPEAKER_00'
// 변경 후
const speakerLabel = raw.speaker ?? raw.speaker_label ?? '화자 1'
```

- [ ] **Step 3: 'SPEAKER_00' 잔존 참조 전수 확인**

Run: `grep -rn "SPEAKER_00" backend/app frontend/src`
Expected: 0건 (테스트 코드 제외 — 테스트에 있으면 함께 갱신). `speakerColor`(SpeakerLabel.tsx:15)는 라벨 끝 숫자 정규식이라 "화자 N"에 이미 동작.

- [ ] **Step 4: 빌드/테스트**

Run: `cd frontend && npx vite build` 그리고 `cd backend && bundle exec rspec spec/jobs/`
Expected: 빌드 성공, PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/jobs/transcription_job.rb frontend/src/channels/transcription.ts
git commit -m "fix(diarization): unify fallback speaker label to '화자 1'"
```

---

### Task 9: 설정 기본값 갱신 + 구 embedding DB 리셋

community-1은 embedding 스택이 3.1(wespeaker 256-d)과 달라 **기존 speaker_dbs/*.json과 threshold 보정값(0.45/0.6/17)이 무효**. 섞이면 조용한 오매칭.

**Files:**
- Modify: 루트 `config.yaml` diarization 블록 (기본값 템플릿)
- Modify: 루트 `settings.yaml` diarization 블록 (런타임 — 직접 수정)
- Delete: `sidecar/speaker_dbs/*.json`

- [ ] **Step 1: 구 DB 백업 후 삭제**

```bash
mkdir -p /tmp/speaker_dbs_backup_pyannote31
cp sidecar/speaker_dbs/*.json /tmp/speaker_dbs_backup_pyannote31/ 2>/dev/null || true
rm -f sidecar/speaker_dbs/*.json
```

- [ ] **Step 2: config.yaml + settings.yaml의 diarization 블록을 코드 기본값으로 리셋**

```yaml
diarization:
  enabled: false          # 파일럿 검증 후 사용자가 토글로 ON
  similarity_threshold: 0.35
  merge_threshold: 0.5
  max_embeddings_per_speaker: 15
```

(0.45/0.6/17은 3.1 기준 튜닝값 — community-1에서는 무의미. 코드 기본값으로 되돌리고 Task 10 파일럿에서 재보정.)

- [ ] **Step 3: Commit** (settings.yaml이 gitignore면 config.yaml만)

```bash
git add config.yaml
git commit -m "chore(diarization): reset thresholds for community-1 embedding space"
```

---

### Task 10: E2E 파일럿 검증 (수동, 실제 한국어 회의 녹음)

community-1/Sortformer/CAM++ 전부 한국어 공표 벤치마크 없음 → 자체 녹음으로 검증 필수.

- [ ] **Step 1: 스택 기동**

```bash
./dev.sh   # 또는 기존 기동 방식. sidecar 로그에서 "pipeline loaded: ...community-1 on mps" 확인
```

- [ ] **Step 2: settings UI에서 화자분리 토글 ON** (DiarizationPanel)

- [ ] **Step 3: 2인 이상 한국어 회의 녹음(또는 기존 회의)에서 `regenerate_stt` 실행**

회의 상세 → STT 재생성 버튼 (또는 `POST /api/v1/meetings/<id>/regenerate_stt`). 완료 후 확인:
- 트랜스크립트에 "화자 1/화자 2..." 배지가 실제 화자 전환과 일치하는가 (몇 군데 샘플 청취 대조)
- SpeakerPanel에서 화자 이름 변경 → 배지 반영되는가 (Task 6 검증)
- 화자 수가 실제 인원과 일치하는가 (과분할/과병합 체크)

- [ ] **Step 4: 성능/메모리 측정 (긴 회의 1개, 가능하면 1시간급)**

sidecar 로그의 `[batch-diarizer] 전체 오디오 처리: N초` ~ 완료 사이 시간 기록. 동시에:

```bash
# 별도 터미널에서 피크 메모리 관찰
while true; do ps -o rss=,comm= -p $(pgrep -f "uvicorn") | awk '{printf "%.1f GB\n", $1/1048576}'; sleep 5; done
```

**리스크 체크**: pyannote 4.0.x 메모리 회귀(이슈 #1963 — 72분 오디오 peak >9.5GB, 미해결). unified memory에서 MLX STT와 경합하면 → `DIARIZATION_DEVICE=cpu`로 재측정, 그래도 문제면 FluidAudio(ANE) 대안 검토 (리서치 문서 §3 대안 참고).

- [ ] **Step 5: 결과를 `docs/diarization-research-2026-06.md` 하단에 "파일럿 결과" 섹션으로 기록** (RTF, 피크 메모리, 화자 정확도 체감, threshold 조정 여부)

---

## 명시적 Out of Scope (이번 플랜에서 안 함)

- **실시간 화자 라벨**: OSS community-1은 배치 전용. 실시간은 2단계 — pyannoteAI Streaming beta(클라우드 opt-in) 또는 FluidAudio LS-EEND(Swift 헬퍼). 리서치 문서 §3 참고.
- **ForcedAligner 단어 단위 정렬**: segment 단위 할당으로 시작 (Qwen3-ForcedAligner는 베트남어 미지원이기도 함). 파일럿에서 세그먼트 중간 화자 전환 오귀속이 심하면 후속.
- **회의 간(cross-meeting) 화자 동일성**: 현 구조는 회의별 DB. 별도 기획 필요.
- **실시간 청크 diarization 코드 삭제**: `speaker.py`의 청크 경로는 그대로 두되 기본 OFF 유지 (배치가 검증되면 후속 정리).

## 주의 함정 (리서치 검증 결과)

- **타임스탬프 timebase**: 전체 파일 diarization 결과는 **같은 파일을 전사한 세그먼트**(`/transcribe-file`의 `_chunked_transcribe`가 절대 ms로 보정함)와만 병합. 실시간 청크 타임스탬프(VAD 게이팅/preroll/overlap trim 거침)에 정렬 금지.
- **pyannote 4.0.x 메모리 회귀** (#1963): 장시간 파일 사전 부하 테스트 필수 (Task 10 Step 4).
- **MPS**: clustering은 CPU-bound라 긴 파일에서 가속 효과 감소. 도입 직후 CPU 결과와 1회 diff 검증 권장 (`DIARIZATION_DEVICE=cpu`로 같은 파일 재실행 → 라벨 비교).
- **겹침 발화**: exclusive timeline + argmax는 동시 발화에서 한 화자만 남김 — 알려진 한계, UI 개선은 후속.
