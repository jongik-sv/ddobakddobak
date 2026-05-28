# Sidecar 리팩토링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sidecar(FastAPI STT/화자분리/LLM 서비스)의 중복·죽은·불합리 코드를 제거하고 1047줄 god 파일 `main.py`를 도메인별 라우터로 분리한다. 동작은 100% 보존한다.

**Architecture:** 대부분 동작 보존(behavior-preserving) 리팩토링. 기존 테스트 105개가 안전망. 커버리지가 얇은 순수 함수(`_find_speaker`, mermaid 보정)는 characterization 테스트를 먼저 추가한 뒤 옮긴다. 작업은 위험도 오름차순 5단계: ①안전한 단발 수정 → ②공유 유틸 추출(dedup) → ③print→logger → ④main.py 라우터 분리 → ⑤대형 모듈 내부 분리(선택).

**Tech Stack:** Python 3.11, FastAPI, pydantic / pydantic-settings, pytest, uv. 작업 디렉터리: `sidecar/`. 테스트 실행: `cd /Users/jji/project/ddobakddobak/sidecar && uv run pytest`.

**불변 제약 (절대 깨면 안 됨):**
- `app.main:app` ASGI 심볼 유지 — Tauri 진입점(`frontend/src-tauri/src/lib.rs:687`), `app-server.sh`, `dev.sh`가 `uv run uvicorn app.main:app`으로 기동.
- 모든 HTTP 경로/요청·응답 스키마 동일 (Rails backend + 프론트가 의존).
- 각 task 끝에 `uv run pytest` 그린 확인 후 커밋.

---

## Phase 1 — 안전한 단발 수정 (독립적, 저위험)

### Task 1: main.py 런타임 NameError 수정 (`Any` 미import)

**Files:**
- Modify: `sidecar/app/main.py`

`lifespan`에서 `app.state.meeting_diarizers: dict[int, Any] = {}` (main.py:204)의 `Any`가 import되지 않음. main.py에 `from __future__ import annotations`가 없어 런타임 평가 → NameError 위험.

- [ ] **Step 1: 재현 — lifespan import 시 NameError 확인**

Run: `cd sidecar && uv run python -c "import app.main"`
Expected: 현재는 import만으론 안 터질 수 있음(런타임 평가는 lifespan 진입 시). 확인용. test_health가 TestClient로 lifespan을 띄우므로 거기서 검출됨.

- [ ] **Step 2: import 추가**

main.py 상단 import 블록(line 2-10 부근)에 추가:

```python
from typing import Any
```

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/main.py
git commit -m "fix(sidecar): import Any to avoid lifespan NameError"
```

---

### Task 2: MockAdapter.transcribe 시그니처를 base와 일치

**Files:**
- Modify: `sidecar/app/stt/mock_adapter.py:23`

`SttAdapter.transcribe(audio_chunk, languages=None, mode="single")`인데 Mock은 `mode`가 없음 → `mode=` 전달 시 TypeError.

- [ ] **Step 1: 실패 테스트 작성** `sidecar/tests/test_mock_adapter.py` (신규)

```python
import pytest
from app.stt.mock_adapter import MockAdapter


@pytest.mark.asyncio
async def test_mock_transcribe_accepts_mode():
    adapter = MockAdapter()
    await adapter.load_model()
    segs = await adapter.transcribe(b"\x00" * 3200, languages=["ko"], mode="multi")
    assert len(segs) == 1
    assert segs[0].text == MockAdapter.DUMMY_TEXT
```

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_mock_adapter.py -v`
Expected: FAIL — `transcribe() got an unexpected keyword argument 'mode'`

- [ ] **Step 3: 시그니처 수정** mock_adapter.py:23

```python
    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
```

- [ ] **Step 4: 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_mock_adapter.py -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/stt/mock_adapter.py sidecar/tests/test_mock_adapter.py
git commit -m "fix(sidecar): align MockAdapter.transcribe signature with base"
```

---

### Task 3: 죽은 코드/스테일 주석 제거

**Files:**
- Modify: `sidecar/app/stt/sentence_segmenter.py:9` (unused `from copy import deepcopy`)
- Modify: `sidecar/app/main.py:516` (떠도는 주석), `main.py:675-677` (오배치 섹션 헤더)
- Modify: `sidecar/app/llm/summarizer.py:514-548` (`apply_feedback` — 호출처 없음)
- Modify: `sidecar/app/stt/factory.py:45-60` (`should_enable_diarization` — 호출처 없음)

먼저 호출처 없음을 재확인한다 (지우기 전 안전 검증).

- [ ] **Step 1: 미사용 재확인**

Run: `cd sidecar && grep -rn "apply_feedback\|should_enable_diarization\|deepcopy" app/ tests/`
Expected: `apply_feedback` 정의(summarizer.py)만, `should_enable_diarization` 정의(factory.py)만, `deepcopy`는 import 라인만. 다른 참조가 나오면 그 항목은 **건너뛴다**.

- [ ] **Step 2: sentence_segmenter.py:9 줄 삭제**

```python
# 삭제: from copy import deepcopy
```

- [ ] **Step 3: main.py 주석 정리**
  - main.py:516 `# _SAMPLE_RATE, _BYTES_PER_SAMPLE는 파일 상단에서 정의됨` 줄 삭제
  - main.py:675-677 의 `# ── LLM 요약 엔드포인트 ──`, `# ── 화자 관리 엔드포인트 ──` 헤더 삭제 (Phase 4에서 라우터로 옮기므로 지금은 제거만)

- [ ] **Step 4: `apply_feedback` 메서드 삭제** (summarizer.py:514-548, docstring 포함 전체 메서드)

- [ ] **Step 5: `should_enable_diarization` 함수 삭제** (factory.py:45-60 전체 함수)

- [ ] **Step 6: 전체 테스트 + import 검증**

Run: `cd sidecar && uv run python -c "import app.main, app.llm.summarizer, app.stt.factory, app.stt.sentence_segmenter" && uv run pytest -q`
Expected: 105 passed (테스트 수는 Task 2에서 +1 → 106)

- [ ] **Step 7: 커밋**

```bash
git add sidecar/app
git commit -m "refactor(sidecar): remove dead code and stale comments"
```

---

### Task 4: factory.py sensevoice 죽은 분기 정리

**Files:**
- Modify: `sidecar/app/stt/factory.py:9-14, 94-103`

`"sensevoice"`가 `_KNOWN_ENGINES`에 있으나 어댑터 없음 → 항상 `NotImplementedError`. 에러 메시지는 `'mock'` 사용을 권하나 mock도 `_KNOWN_ENGINES`/팩토리 분기에 없음.

- [ ] **Step 1: 현재 동작 확인 (test_stt_factory가 무엇을 검증하는지)**

Run: `cd sidecar && uv run pytest tests/test_stt_factory.py -v`
Expected: PASS (sensevoice 기대 동작이 있으면 그에 맞춰 보존)

- [ ] **Step 2: `_KNOWN_ENGINES`에서 `"sensevoice"` 제거** factory.py:9-14

```python
_KNOWN_ENGINES: frozenset[str] = frozenset(
    {"qwen3_asr_4bit", "qwen3_asr_6bit", "qwen3_asr_8bit",
     "qwen3_asr_transformers",
     "whisper_cpp", "faster_whisper", "faster_whisper_cpu",
     "auto"}
)
```

- [ ] **Step 3: mock 엔진 명시 지원 추가** factory.py `create_stt_adapter` 분기에 추가 (auto 처리 직후):

```python
    if engine == "mock":
        from app.stt.mock_adapter import MockAdapter
        return MockAdapter()
```

그리고 `_KNOWN_ENGINES`에 `"mock"` 추가 → NotImplementedError 메시지의 mock 권유가 실제로 유효해짐.

- [ ] **Step 4: 검증**

Run: `cd sidecar && uv run pytest tests/test_stt_factory.py -v`
Expected: PASS. sensevoice 관련 테스트가 깨지면 그 테스트도 함께 갱신(엔진 목록에서 제거).

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/stt/factory.py sidecar/tests/test_stt_factory.py
git commit -m "refactor(sidecar): drop unimplemented sensevoice, register mock engine"
```

---

## Phase 2 — 공유 유틸 추출 (중복 제거)

### Task 5: 오디오 상수 단일화

**Files:**
- Create: `sidecar/app/audio_constants.py`
- Modify: `app/main.py`, `app/diarization/speaker.py`, `app/diarization/batch_processor.py`, `app/diarization/whisperx_processor.py`

`_SAMPLE_RATE=16000`, `_BYTES_PER_SAMPLE=2`, `_SEC_TO_MS=1000`가 여러 파일에 중복 정의.

- [ ] **Step 1: 상수 모듈 생성** `sidecar/app/audio_constants.py`

```python
"""오디오 처리 공통 상수 (PCM 16kHz mono Int16 기준)."""

SAMPLE_RATE = 16000          # Hz
BYTES_PER_SAMPLE = 2         # Int16
SEC_TO_MS = 1000
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE
MIN_AUDIO_BYTES = BYTES_PER_SEC  # 1초 미만은 화자분리 불안정
```

- [ ] **Step 2: 각 파일에서 로컬 상수 정의를 import로 교체**

`speaker.py:22-25` → 삭제 후 상단에 `from app.audio_constants import SAMPLE_RATE as _SAMPLE_RATE, BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE, SEC_TO_MS as _SEC_TO_MS, MIN_AUDIO_BYTES as _MIN_AUDIO_BYTES` (별칭으로 기존 사용처 유지).

`batch_processor.py:14-16` → 삭제 후 `from app.audio_constants import SAMPLE_RATE as _SAMPLE_RATE, BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE, SEC_TO_MS as _SEC_TO_MS`.

`whisperx_processor.py:21-22` → 삭제 후 `from app.audio_constants import SAMPLE_RATE as _SAMPLE_RATE, SEC_TO_MS as _SEC_TO_MS`.

`main.py:39-40` → 삭제 후 `from app.audio_constants import SAMPLE_RATE as _SAMPLE_RATE, BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE`. (main.py:60-61의 `MIN_CHUNK_BYTES` 계산은 그대로 유지.)

> 참고: 별칭을 쓰는 이유는 본문 내 `_SAMPLE_RATE` 등 기존 참조를 건드리지 않아 diff를 최소화하기 위함. 본문 다수 치환은 회귀 위험.

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run python -c "import app.main, app.diarization.speaker, app.diarization.batch_processor" && uv run pytest -q`
Expected: 106 passed

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/audio_constants.py sidecar/app
git commit -m "refactor(sidecar): centralize audio constants"
```

---

### Task 6: PCM→float32 변환을 공통 헬퍼로 통일

**Files:**
- Modify: `app/diarization/speaker.py:227`, `app/diarization/batch_processor.py:67`, `app/diarization/whisperx_processor.py:140,153`

인라인 `np.frombuffer(...,int16).astype(float32)/32768.0`가 4곳. 기존 `app/stt/audio_utils.py:pcm_bytes_to_float32`로 대체.

- [ ] **Step 1: speaker.py:227 교체**

```python
        from app.stt.audio_utils import pcm_bytes_to_float32
        audio_array = pcm_bytes_to_float32(audio_bytes)
```
(기존 `import numpy as np`는 다른 용도로 쓰이면 유지.)

- [ ] **Step 2: batch_processor.py:67 교체**

```python
    from app.stt.audio_utils import pcm_bytes_to_float32
    audio_array = pcm_bytes_to_float32(audio_bytes)
```

- [ ] **Step 3: whisperx_processor.py:140 교체** (`_process_bytes_sync`)

```python
        from app.stt.audio_utils import pcm_bytes_to_float32
        audio = pcm_bytes_to_float32(audio_bytes)
```

- [ ] **Step 4: whisperx_processor.py:153 교체** (`_process_file_sync`의 .raw 분기)

```python
            from app.stt.audio_utils import pcm_bytes_to_float32
            with open(file_path, "rb") as f:
                audio = pcm_bytes_to_float32(f.read())
```

- [ ] **Step 5: 검증**

Run: `cd sidecar && uv run pytest tests/test_speaker_diarization.py -q && uv run pytest -q`
Expected: 106 passed

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/diarization
git commit -m "refactor(sidecar): reuse pcm_bytes_to_float32 helper"
```

---

### Task 7: `_find_speaker` 중복 제거 (byte-identical)

**Files:**
- Create: `sidecar/app/diarization/overlap.py`
- Modify: `app/diarization/speaker.py:406-420`, `app/diarization/batch_processor.py:94-106`

`_find_speaker`가 두 파일에 완전히 동일. 커버리지 확인 후 추출.

- [ ] **Step 1: characterization 테스트 작성** `sidecar/tests/test_overlap.py` (신규)

```python
from app.diarization.overlap import find_speaker_by_overlap


def test_find_speaker_picks_max_overlap():
    diar = {(0, 1000): "화자 1", (900, 3000): "화자 2"}
    # 950~2000: 화자2와 더 많이 겹침
    assert find_speaker_by_overlap(950, 2000, diar) == "화자 2"


def test_find_speaker_none_when_no_overlap():
    diar = {(0, 1000): "화자 1"}
    assert find_speaker_by_overlap(2000, 3000, diar) is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_overlap.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: overlap.py 생성**

```python
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_overlap.py -v`
Expected: PASS

- [ ] **Step 5: speaker.py에서 사용** — `_find_speaker` 함수 정의(406-420) 삭제, 상단에 `from app.diarization.overlap import find_speaker_by_overlap`, `merge_with_segments` 내부 `_find_speaker(...)` 호출(395)을 `find_speaker_by_overlap(...)`로 교체.

- [ ] **Step 6: batch_processor.py에서 사용** — `_find_speaker` 함수 정의(94-106) 삭제, 상단에 `from app.diarization.overlap import find_speaker_by_overlap`, 52번 호출을 `find_speaker_by_overlap(...)`로 교체.

- [ ] **Step 7: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 107 passed

- [ ] **Step 8: 커밋**

```bash
git add sidecar/app/diarization sidecar/tests/test_overlap.py
git commit -m "refactor(sidecar): extract shared find_speaker_by_overlap"
```

---

### Task 8: settings.yaml/min_chunk_sec 로딩 중복 제거

**Files:**
- Modify: `sidecar/app/config.py`, `sidecar/app/main.py:42-61`

`config.py:_load_settings_yaml`와 `main.py:_load_min_chunk_sec`가 둘 다 `parent.parent.parent`로 yaml을 읽음(2회 디스크 I/O). config.py가 단일 진입점이 되도록 `min_chunk_sec`를 Settings로 흡수.

- [ ] **Step 1: config.py `_load_settings_yaml`에 audio.min_chunk_sec 수집 추가** (env dict 채우는 부분):

```python
            # Audio
            if (min_chunk := (cfg.get("audio") or {}).get("min_chunk_sec")) is not None:
                env["MIN_CHUNK_SEC"] = str(min_chunk)
```

- [ ] **Step 2: Settings 클래스에 필드 추가** (config.py, MODELS_DIR 부근):

```python
    # [재시작 필요] 오디오 최소 청크 길이 (초). 이보다 짧으면 환각 방지로 STT 스킵
    MIN_CHUNK_SEC: float = 1.0
```

- [ ] **Step 3: main.py에서 `_load_min_chunk_sec` 제거하고 settings 사용** (main.py:42-61):

```python
from app.audio_constants import SAMPLE_RATE as _SAMPLE_RATE, BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE

MIN_CHUNK_SEC = settings.MIN_CHUNK_SEC
MIN_CHUNK_BYTES = int(MIN_CHUNK_SEC * _SAMPLE_RATE * _BYTES_PER_SAMPLE)
```
(`_load_min_chunk_sec` 함수 전체 삭제. `settings`는 이미 main.py:33에서 import됨.)

- [ ] **Step 4: 검증 — min_chunk 동작 보존**

Run: `cd sidecar && uv run pytest -q`
Expected: 107 passed

설정 로딩 회귀 점검: 프로젝트 루트에 `settings.yaml`이 있으면 `audio.min_chunk_sec` 값이 반영되는지 수동 확인:
Run: `cd sidecar && uv run python -c "from app.config import settings; print('MIN_CHUNK_SEC=', settings.MIN_CHUNK_SEC)"`
Expected: settings.yaml 값(없으면 1.0)

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/config.py sidecar/app/main.py
git commit -m "refactor(sidecar): load min_chunk_sec via settings, drop dup yaml read"
```

---

### Task 9: 엔진 탐지 try/except 블록 데이터화

**Files:**
- Modify: `sidecar/app/main.py:93-132` (`_detect_available_engines`)

반복되는 `try: import X; available.append(...) except ImportError: pass` 패턴. 단순 단일 패키지는 테이블 루프로, 조건부(torch.cuda, bitsandbytes 등)는 남긴다. **과도한 일반화 금지 (YAGNI)** — 가독성이 떨어지면 현행 유지가 낫다.

- [ ] **Step 1: characterization 테스트** `sidecar/tests/test_engine_detect.py` (신규)

```python
from app.main import _detect_available_engines


def test_detect_returns_list_of_str():
    engines = _detect_available_engines()
    assert isinstance(engines, list)
    assert all(isinstance(e, str) for e in engines)
```

- [ ] **Step 2: 통과 확인 (현행 동작 캡처)**

Run: `cd sidecar && uv run pytest tests/test_engine_detect.py -v`
Expected: PASS

- [ ] **Step 3: 단순 패키지 프로브만 헬퍼로 추출** main.py에 추가:

```python
def _has_module(name: str) -> bool:
    import importlib.util
    return importlib.util.find_spec(name) is not None
```

`_detect_available_engines` 안에서 단일 모듈 가용성 체크를 `_has_module(...)`로 치환. torch.cuda/bitsandbytes/qwen3 캐시 분기는 의미가 복잡하므로 **그대로 둔다**.

- [ ] **Step 4: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 108 passed. `_detect_available_engines()` 결과가 변경 전과 동일해야 함 (Step 1 테스트가 보장).

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/main.py sidecar/tests/test_engine_detect.py
git commit -m "refactor(sidecar): simplify single-module engine probing"
```

---

### Task 10: 세그먼트 직렬화 헬퍼 + transcribe_file 기본 구현

**Files:**
- Modify: `sidecar/app/main.py:387,484`
- Modify: `sidecar/app/stt/base.py`, `app/stt/whisper_adapter.py:121-125`, `app/stt/qwen3_adapter.py:116-120`

(a) `[SegmentResponse(**dataclasses.asdict(seg)) for seg in segments]`가 2곳. (b) `transcribe_file`이 whisper/qwen3에서 동일 (read bytes → self.transcribe).

- [ ] **Step 1: main.py에 직렬화 헬퍼 추가** (스키마 정의 이후, transcribe 이전):

```python
def _segments_to_response(segments) -> list[SegmentResponse]:
    return [SegmentResponse(**dataclasses.asdict(seg)) for seg in segments]
```

main.py:387, :484의 리스트 컴프리헨션을 `_segments_to_response(segments)`로 교체.

- [ ] **Step 2: base.py에 transcribe_file 기본 구현 제공** — `transcribe_file`을 `@abstractmethod`에서 일반 메서드로 변경:

```python
    async def transcribe_file(self, file_path: str) -> list[TranscriptSegment]:
        """파일 전체 변환. 기본 구현: 파일을 읽어 transcribe()에 위임."""
        with open(file_path, "rb") as f:
            audio_bytes = f.read()
        return await self.transcribe(audio_bytes)
```

- [ ] **Step 3: 중복 구현 제거** — whisper_adapter.py:121-125, qwen3_adapter.py:116-120의 `transcribe_file`이 위 기본 구현과 동일하면 삭제. **다르면(추가 로직 있으면) 남긴다** — 삭제 전 두 메서드 본문을 base 기본 구현과 정확히 비교.

- [ ] **Step 4: 검증**

Run: `cd sidecar && uv run pytest tests/test_whisper_adapter.py tests/test_qwen3_adapter.py -q && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app
git commit -m "refactor(sidecar): dedup segment serialization and transcribe_file"
```

---

## Phase 3 — print → logger 통일

### Task 11: diarization/main의 print를 logger로

**Files:**
- Modify: `app/main.py`(16), `app/diarization/speaker.py`(9), `app/diarization/whisperx_processor.py`(11), `app/diarization/batch_processor.py`(2), `app/stt/factory.py`(1)

`print(..., flush=True)` 진단 출력을 모듈 `logger`로 교체. 동작 영향 없음(로그 채널만 변경).

- [ ] **Step 1: 각 파일 상단에 logger 준비** (없는 파일만):

```python
import logging
logger = logging.getLogger(__name__)
```
대상: speaker.py, whisperx_processor.py, batch_processor.py, factory.py. (main.py는 이미 있음.)

- [ ] **Step 2: print → logger 치환 규칙**
  - 일반 정보: `print(f"...", flush=True)` → `logger.info("...")`
  - `WARNING`/실패 메시지: `logger.warning(...)` 또는 `logger.error(...)`
  - f-string은 유지 가능하나, 가능하면 `logger.info("%s", x)` lazy 포맷 권장. 대량이면 f-string 유지해도 무방.
  - `except ... : print(...)` (speaker.py:166,187 / main.py:383 등)는 `logger.error(...)` 또는 `logger.exception(...)`로.

- [ ] **Step 3: 잔여 print 확인**

Run: `cd sidecar && grep -rn "print(" app/ | grep -v "blueprint\|fingerprint"`
Expected: 빈 결과 (또는 의도적으로 남긴 항목만)

- [ ] **Step 4: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app
git commit -m "refactor(sidecar): replace print diagnostics with logger"
```

---

## Phase 4 — main.py 라우터 분리

> 목표 구조:
> ```
> app/main.py            # FastAPI(), lifespan, include_router만 (~80줄)
> app/bootstrap.py       # multiprocessing/torch sharing
> app/schemas.py         # Pydantic 모델 전부
> app/engines.py         # _is_model_cached, _detect_available_engines, AVAILABLE_STT_ENGINES, _has_module
> app/env_utils.py       # _find_env_file, _persist_env, _mask_token
> app/deps.py            # _get_summarizer, _get_meeting_diarizer, _ensure_diarizer_pipeline
> app/routers/{health,stt,llm,settings,speakers}.py
> ```
> 핵심 난점: 라우터들이 `app.state`에 접근. FastAPI에서는 핸들러 인자 `request: Request` → `request.app.state`로 접근하거나, 모듈 전역 `from app.main import app` 순환을 피하려고 `request.app` 사용. **모든 라우터는 `request.app.state`를 쓴다.** 모듈 전역 `app` 참조 금지.

### Task 12: bootstrap.py 추출

**Files:**
- Create: `sidecar/app/bootstrap.py`
- Modify: `sidecar/app/main.py:1-27`

- [ ] **Step 1: bootstrap.py 생성** — main.py:16-27의 multiprocessing/torch sharing 설정 이동:

```python
"""프로세스 시작 설정 (import 시 1회 실행). main 최상단에서 import해야 한다."""
import multiprocessing
import os

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")

if multiprocessing.get_start_method(allow_none=True) is None:
    multiprocessing.set_start_method("spawn")

try:
    import torch.multiprocessing as _tmp
    _tmp.set_sharing_strategy("file_system")
    del _tmp
except Exception:
    pass
```

- [ ] **Step 2: main.py에서 `import app.bootstrap  # noqa: F401` 을 다른 무거운 import보다 먼저** 두고 기존 16-27 블록 삭제. 순서 중요: `set_start_method`는 torch/멀티프로세싱 사용 전에 실행돼야 함.

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/bootstrap.py sidecar/app/main.py
git commit -m "refactor(sidecar): extract process bootstrap module"
```

---

### Task 13: schemas.py 추출

**Files:**
- Create: `sidecar/app/schemas.py`
- Modify: `sidecar/app/main.py`

main.py 전역에 흩어진 Pydantic 모델 전부 이동: `HealthResponse, UpdateSttEngineRequest, TranscribeRequest, SegmentResponse, TranscribeResponse, TranscribeFileRequest, TranscribeFileResponse, TranscriptItem, ActionItemResult, LlmConfigOverride, SummarizeRequest, SummarizeResponse, ActionItemsRequest, ActionItemsResponse, UpdateLlmSettingsRequest, UpdateHfSettingsRequest, TestLlmRequest, RenameSpeakerRequest, RefineNotesRequest, RefineNotesResponse, BuildPromptRequest, BuildPromptResponse, TermCorrection, CorrectTermsRequest, CorrectTermsResponse`.

- [ ] **Step 1: schemas.py 생성** — 위 모델 정의를 그대로 옮긴다. import 헤더:

```python
"""Sidecar API 요청/응답 Pydantic 스키마."""
from __future__ import annotations

import binascii

from pydantic import BaseModel, ConfigDict, Field, field_validator
```
`TranscribeRequest.validate_base64`가 `binascii` 사용하므로 포함.

- [ ] **Step 2: main.py에서 모델 정의 삭제 후 import**

```python
from app.schemas import (
    HealthResponse, UpdateSttEngineRequest, TranscribeRequest, SegmentResponse,
    TranscribeResponse, TranscribeFileRequest, TranscribeFileResponse,
    TranscriptItem, ActionItemResult, LlmConfigOverride, SummarizeRequest,
    SummarizeResponse, ActionItemsRequest, ActionItemsResponse,
    UpdateLlmSettingsRequest, UpdateHfSettingsRequest, TestLlmRequest,
    RenameSpeakerRequest, RefineNotesRequest, RefineNotesResponse,
    BuildPromptRequest, BuildPromptResponse, TermCorrection,
    CorrectTermsRequest, CorrectTermsResponse,
)
```

- [ ] **Step 3: 검증 (스키마 동작·검증자 보존)**

Run: `cd sidecar && uv run pytest tests/test_ws_transcribe.py tests/test_summarizer.py tests/test_health.py -q && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/schemas.py sidecar/app/main.py
git commit -m "refactor(sidecar): extract pydantic schemas module"
```

---

### Task 14: engines.py · env_utils.py 추출

**Files:**
- Create: `sidecar/app/engines.py`, `sidecar/app/env_utils.py`
- Modify: `sidecar/app/main.py`

- [ ] **Step 1: engines.py 생성** — main.py에서 `_is_model_cached`, `_detect_available_engines`, `_has_module`(Task9), `AVAILABLE_STT_ENGINES` 이동. `AVAILABLE_STT_ENGINES = _detect_available_engines()`는 모듈 로드 시 1회 계산 — 유지.

- [ ] **Step 2: env_utils.py 생성** — `_find_env_file`, `_persist_env`, `_mask_token` 이동. 상단 `from pathlib import Path` (함수 내부 import였던 것 hoist). `_llm_token_and_url`는 settings/CLI_LLM_PROVIDERS에 의존하므로 settings 라우터에 두거나 env_utils에 둘 수 있음 — **settings 라우터(Task 16)에 둔다.**

- [ ] **Step 3: main.py에서 정의 삭제 후 import**

```python
from app.engines import AVAILABLE_STT_ENGINES
from app.env_utils import _persist_env, _mask_token
```
(test_engine_detect.py가 `from app.main import _detect_available_engines`를 참조하므로, main.py에 `from app.engines import _detect_available_engines  # re-export` 한 줄 유지하거나 테스트 import 경로를 `app.engines`로 갱신. → **테스트를 `app.engines`로 갱신**.)

- [ ] **Step 4: test_engine_detect.py import 경로 수정**

```python
from app.engines import _detect_available_engines
```

- [ ] **Step 5: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/engines.py sidecar/app/env_utils.py sidecar/app/main.py sidecar/tests/test_engine_detect.py
git commit -m "refactor(sidecar): extract engines and env_utils modules"
```

---

### Task 15: deps.py 추출 (app.state 접근 헬퍼)

**Files:**
- Create: `sidecar/app/deps.py`
- Modify: `sidecar/app/main.py`

`_ensure_diarizer_pipeline`, `_get_meeting_diarizer`, `_get_summarizer`는 `app.state`를 직접 참조. 라우터에서 재사용하려면 `app`을 인자로 받도록 시그니처 변경.

- [ ] **Step 1: deps.py 생성** — 세 함수를 `app: FastAPI`(또는 `request.app`)를 첫 인자로 받도록 옮긴다:

```python
"""app.state 접근 의존성 헬퍼."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI

from app.config import settings
from app.llm.summarizer import LLMSummarizer
from app.schemas import LlmConfigOverride

logger = logging.getLogger(__name__)


async def ensure_diarizer_pipeline(app: FastAPI):
    if app.state.diarizer_pipeline is not None:
        return app.state.diarizer_pipeline
    if app.state.diarizer_loading:
        return None
    if not settings.HF_TOKEN:
        return None
    app.state.diarizer_loading = True
    try:
        from app.diarization.speaker import SpeakerDiarizer
        _loader = SpeakerDiarizer()
        await _loader.load(hf_token=settings.HF_TOKEN)
        app.state.diarizer_pipeline = _loader.pipeline
        logger.info("화자 구분 모델 lazy load 완료")
        return app.state.diarizer_pipeline
    except Exception as e:
        logger.error("화자 구분 모델 로드 실패: %s", e)
        return None
    finally:
        app.state.diarizer_loading = False


def get_meeting_diarizer(app: FastAPI, meeting_id: int | None, diarization_config: dict | None = None):
    from app.diarization.speaker import make_meeting_diarizer
    pipeline = getattr(app.state, "diarizer_pipeline", None)
    if pipeline is None or meeting_id is None:
        return None
    if diarization_config and not diarization_config.get("enable", True):
        return None
    diarizers: dict = app.state.meeting_diarizers
    if meeting_id not in diarizers:
        kwargs = {}
        if diarization_config:
            kwargs = {k: v for k, v in diarization_config.items()
                      if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        diarizers[meeting_id] = make_meeting_diarizer(meeting_id, pipeline, **kwargs)
    elif diarization_config:
        config_kwargs = {k: v for k, v in diarization_config.items()
                         if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        if config_kwargs:
            diarizers[meeting_id].update_config(**config_kwargs)
    return diarizers[meeting_id]


def get_summarizer(app: FastAPI, llm_config: LlmConfigOverride | None) -> LLMSummarizer:
    if llm_config is None:
        return app.state.summarizer
    override = settings.model_copy()
    override.LLM_PROVIDER = llm_config.provider
    override.LLM_MODEL = llm_config.model
    if llm_config.provider == "openai":
        override.OPENAI_API_KEY = llm_config.auth_token
        override.OPENAI_BASE_URL = llm_config.base_url or ""
    else:
        override.ANTHROPIC_AUTH_TOKEN = llm_config.auth_token
        override.ANTHROPIC_BASE_URL = llm_config.base_url or ""
    return LLMSummarizer(settings_override=override)
```

- [ ] **Step 2: 이번 단계는 추가만** — main.py의 기존 `_ensure_diarizer_pipeline`/`_get_meeting_diarizer`/`_get_summarizer`는 라우터 분리(Task 16~) 전까지 유지하되, 내부를 deps 위임으로 바꿔 중복 제거:

```python
async def _ensure_diarizer_pipeline():
    return await ensure_diarizer_pipeline(app)

def _get_meeting_diarizer(meeting_id, diarization_config=None):
    return get_meeting_diarizer(app, meeting_id, diarization_config)

def _get_summarizer(llm_config):
    return get_summarizer(app, llm_config)
```
상단에 `from app.deps import ensure_diarizer_pipeline, get_meeting_diarizer, get_summarizer`.

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run pytest -q`
Expected: 108 passed

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/deps.py sidecar/app/main.py
git commit -m "refactor(sidecar): extract app.state dependency helpers"
```

---

### Task 16: 라우터 분리 — health, speakers, settings (의존성 적은 순)

**Files:**
- Create: `sidecar/app/routers/__init__.py`, `health.py`, `speakers.py`, `settings.py`
- Modify: `sidecar/app/main.py`

각 라우터는 `APIRouter()`를 정의하고 핸들러는 `request: Request`로 `request.app.state` 접근. main.py는 `app.include_router(...)`.

- [ ] **Step 1: `app/routers/__init__.py` 빈 파일 생성**

- [ ] **Step 2: health.py 생성** — `/health`, `GET/PUT /settings/stt-engine` 이동. `engine_lock`은 `request.app.state.engine_lock`. `AVAILABLE_STT_ENGINES`는 `from app.engines import AVAILABLE_STT_ENGINES`. 예:

```python
from fastapi import APIRouter, HTTPException, Request
from app.config import settings
from app.engines import AVAILABLE_STT_ENGINES
from app.schemas import HealthResponse, UpdateSttEngineRequest

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    adapter = getattr(request.app.state, "stt_adapter", None)
    return HealthResponse(
        status="ok",
        stt_engine=settings.STT_ENGINE,
        model_loaded=adapter.is_loaded if adapter is not None else False,
    )
# get/put stt-engine 동일 패턴으로 이동 (update_stt_engine은 _persist_env 사용 → from app.env_utils import _persist_env, from app.stt.factory import create_stt_adapter)
```

- [ ] **Step 3: speakers.py 생성** — `GET /speakers`, `PUT /speakers/{speaker_id}`, `DELETE /speakers` 이동. `get_meeting_diarizer(request.app, ...)` 사용. `app.state.meeting_diarizers.pop`도 `request.app.state...`.

- [ ] **Step 4: settings.py 생성** — `GET/PUT /settings/llm`, `POST /settings/llm/test`, `GET/PUT /settings/hf` 이동. `_mask_token`은 env_utils에서, `_llm_token_and_url`은 이 파일에 정의(또는 env_utils). `_get_summarizer` 대신 `get_summarizer(request.app, ...)`. `app.state.summarizer` 재생성도 `request.app.state.summarizer = LLMSummarizer()`.

- [ ] **Step 5: main.py에서 해당 핸들러 삭제 + include_router**

```python
from app.routers import health, speakers, settings as settings_router
app.include_router(health.router)
app.include_router(speakers.router)
app.include_router(settings_router.router)
```

- [ ] **Step 6: 검증 (경로 보존이 핵심)**

Run: `cd sidecar && uv run pytest tests/test_health.py tests/test_summarizer.py -q && uv run pytest -q`
Expected: 108 passed

수동 경로 확인:
Run: `cd sidecar && uv run python -c "from app.main import app; print(sorted({r.path for r in app.routes}))"`
Expected: `/health`, `/settings/stt-engine`, `/settings/llm`, `/settings/llm/test`, `/settings/hf`, `/speakers`, `/speakers/{speaker_id}` 모두 존재.

- [ ] **Step 7: 커밋**

```bash
git add sidecar/app/routers sidecar/app/main.py
git commit -m "refactor(sidecar): split health/speakers/settings routers"
```

---

### Task 17: 라우터 분리 — llm

**Files:**
- Create: `sidecar/app/routers/llm.py`
- Modify: `sidecar/app/main.py`

`/summarize`, `/summarize/action-items`, `/refine-notes`, `/build-prompt`, `/feedback-notes` 이동. `refine_notes`의 `app.state.refine_locks` → `request.app.state.refine_locks`. `get_summarizer(request.app, ...)` 사용.

- [ ] **Step 1: llm.py 생성** — 위 5개 핸들러 이동. import: `from app.deps import get_summarizer`, `from app.config import settings`, `from app.schemas import (Summarize..., RefineNotes..., BuildPrompt..., CorrectTerms..., ActionItems...)`. `correct_terms`는 LLM 없이 문자열 치환만 — 그대로.

- [ ] **Step 2: main.py에서 핸들러 삭제 + include**

```python
from app.routers import llm
app.include_router(llm.router)
```

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run pytest tests/test_summarizer.py -q && uv run pytest -q`
Expected: 108 passed. 경로 `/summarize`, `/summarize/action-items`, `/refine-notes`, `/build-prompt`, `/feedback-notes` 존재 확인 (Task16 Step6 방식).

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/routers/llm.py sidecar/app/main.py
git commit -m "refactor(sidecar): split llm router"
```

---

### Task 18: 라우터 분리 — stt (가장 무겁고 의존 많음, 마지막)

**Files:**
- Create: `sidecar/app/routers/stt.py`
- Modify: `sidecar/app/main.py`

`/transcribe`, `/transcribe-file`, `WS /ws/transcribe` + 헬퍼 `_chunked_transcribe`, `_try_whisperx_batch` 이동. `MIN_CHUNK_BYTES`, `MIN_CHUNK_SEC`, `_SAMPLE_RATE`, `_BYTES_PER_SAMPLE`, `_segments_to_response`는 stt 라우터로 함께 이동(또는 audio_constants/schemas에서 import). `ensure_diarizer_pipeline(request.app)`, `get_meeting_diarizer(request.app, ...)` 사용. `app.state.stt_adapter`/`gpu_lock` → `request.app.state...`.

- [ ] **Step 1: stt.py 생성** — 핸들러 3개 + 헬퍼 2개 이동. `_segments_to_response`, `MIN_CHUNK_*` 상수도 이 파일로. import 정리. WS 핸들러는 `@router.websocket("/ws/transcribe")`.

- [ ] **Step 2: main.py에서 삭제 + include**

```python
from app.routers import stt
app.include_router(stt.router)
```

- [ ] **Step 3: 검증 (WS + transcribe 경로 핵심)**

Run: `cd sidecar && uv run pytest tests/test_ws_transcribe.py -q && uv run pytest -q`
Expected: 108 passed. 경로 `/transcribe`, `/transcribe-file`, `/ws/transcribe` 존재 확인.

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/routers/stt.py sidecar/app/main.py
git commit -m "refactor(sidecar): split stt router; main.py now thin app assembly"
```

---

### Task 19: main.py 최종 정리 확인

**Files:**
- Modify: `sidecar/app/main.py`

- [ ] **Step 1: main.py가 앱 조립만 남았는지 확인** — import bootstrap, lifespan, `app = FastAPI(...)`, include_router 5개, lifespan에서 app.state 초기화(`stt_adapter`, `summarizer`, `engine_lock`, `gpu_lock`, `refine_locks`, `diarizer_pipeline`, `diarizer_loading`, `meeting_diarizers`). 그 외 비즈니스 로직 없음.

- [ ] **Step 2: 줄 수 확인**

Run: `cd sidecar && wc -l app/main.py`
Expected: ~80-120줄 (1047에서 대폭 감소)

- [ ] **Step 3: 전체 회귀 + ASGI 심볼 확인**

Run: `cd sidecar && uv run pytest -q && uv run python -c "from app.main import app; print('app ok', type(app).__name__)"`
Expected: 108 passed, `app ok FastAPI`

- [ ] **Step 4: 커밋 (변경 있으면)**

```bash
git add sidecar/app/main.py
git commit -m "refactor(sidecar): finalize thin main.py"
```

---

## Phase 5 — 대형 모듈 내부 분리 (선택, 별도 판단)

> Phase 4 완료 후 진행 여부 재판단. main.py 분리와 독립적. 시간/위험 대비 효과가 낮다고 판단되면 생략 가능.

### Task 20: summarizer.py 분리

**Files:**
- Create: `sidecar/app/llm/prompts.py`, `sidecar/app/llm/markdown_postprocess.py`, `sidecar/app/llm/cli_backends.py`
- Modify: `sidecar/app/llm/summarizer.py`

- [ ] **Step 1: prompts.py로 프롬프트 상수 이동** — `_SUMMARIZE_SYSTEM_PROMPT`, `_ACTION_ITEMS_SYSTEM_PROMPT`, `_DEFAULT_SECTION_STRUCTURE`, `_REFINE_NOTES_SYSTEM_PROMPT`, `_FEEDBACK_NOTES_SYSTEM_PROMPT`(apply_feedback 삭제했으면 이것도 삭제됨 — 잔존 여부 확인), `_build_refine_prompt_from_text`. summarizer.py에서 import.

- [ ] **Step 2: markdown_postprocess.py로 출력 후처리 이동** — `_extract_json`, `_strip_markdown_fence`, `_fix_mermaid_quotes` + 관련 regex(`_RE_MERMAID_BLOCK` 등). `_quote_labels`의 3중 `.sub`를 `[(_RE_SQUARE_NODE,'[',']'), (_RE_CURLY_NODE,'{','}'), (_RE_PAREN_NODE,'(',')')]` 루프로 단순화.

- [ ] **Step 3: characterization 테스트 추가** `sidecar/tests/test_markdown_postprocess.py` — mermaid 따옴표 보정/fence 제거의 현재 동작 캡처(분리 전후 동일 보장):

```python
from app.llm.markdown_postprocess import _fix_mermaid_quotes, _strip_markdown_fence

def test_strip_fence():
    assert _strip_markdown_fence("```markdown\nhello\n```") == "hello"

def test_mermaid_quotes_added():
    src = "```mermaid\nA[라벨] --> B{조건}\n```"
    out = _fix_mermaid_quotes(src)
    assert 'A["라벨"]' in out and 'B{"조건"}' in out
```

- [ ] **Step 4: cli_backends.py로 CLI 러너 이동** — `_run_cli`, `_call_claude_cli`, `_call_gemini_cli`, `_call_codex_cli`. settings 의존이므로 함수에 settings 전달 또는 클래스 유지. **분리 비용이 크면 summarizer 내부에 두고 Step 1~3만 수행.**

- [ ] **Step 5: 검증**

Run: `cd sidecar && uv run pytest tests/test_summarizer.py tests/test_markdown_postprocess.py -q && uv run pytest -q`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/llm sidecar/tests/test_markdown_postprocess.py
git commit -m "refactor(sidecar): split summarizer into prompts/postprocess/cli"
```

---

### Task 21: speaker.py 분리 (SpeakerDB)

**Files:**
- Create: `sidecar/app/diarization/speaker_db.py`
- Modify: `sidecar/app/diarization/speaker.py`

- [ ] **Step 1: SpeakerDB 클래스 추출** — `_is_valid_embedding`, `_load_db`, `_save_db` + `_speaker_embeddings`/`_speaker_names`/`_next_num` 상태를 `SpeakerDB`로 캡슐화. `SpeakerDiarizer`가 `self._db = SpeakerDB(db_path)` 보유. **상태 이동은 회귀 위험이 크다** — test_speaker_diarization.py 통과를 단계마다 확인.

- [ ] **Step 2: `_fallback_speaker` 추출** — `_run_pipeline`의 "마지막 화자 또는 새 화자" 폴백 로직(248-251, 257-262 중복)을 메서드로.

- [ ] **Step 3: 검증**

Run: `cd sidecar && uv run pytest tests/test_speaker_diarization.py -q && uv run pytest -q`
Expected: 전부 PASS

- [ ] **Step 4: 커밋**

```bash
git add sidecar/app/diarization
git commit -m "refactor(sidecar): extract SpeakerDB and fallback helper"
```

---

## 최종 검증 (전 Phase 완료 후)

- [ ] **전체 테스트**: `cd sidecar && uv run pytest` → 전부 PASS (≥108)
- [ ] **ASGI 심볼**: `cd sidecar && uv run python -c "from app.main import app"` → 에러 없음
- [ ] **경로 불변**: 분리 전후 라우트 집합 동일 (health/stt/llm/settings/speakers 전 경로)
- [ ] **잔여 print 0**: `grep -rn "print(" sidecar/app` → 없음
- [ ] **main.py 줄 수**: ~100줄
- [ ] **앱 기동 스모크**(선택): `dev.sh` 또는 `uv run uvicorn app.main:app --port 13399` 로 `/health` 200 확인

---

## Self-Review 체크리스트 결과

- **Spec 커버리지**: investigator 발견 항목 전부 task에 매핑됨 — NameError(T1), mock 시그니처(T2), 죽은코드(T3,T4), 오디오상수 중복(T5), PCM변환 중복(T6), _find_speaker 중복(T7), yaml 로딩 중복(T8), 엔진탐지 패턴(T9), 직렬화/transcribe_file 중복(T10), print(T11), main 분리(T12-19), 대형모듈(T20,T21).
- **Placeholder 스캔**: 각 코드 변경 스텝에 실제 코드 포함. "적절히 처리" 류 없음. 단, Phase 5는 회귀 위험이 큰 상태 이동이라 "단계마다 테스트 확인" 가드를 명시 — 의도적.
- **타입 일관성**: deps 함수명 `ensure_diarizer_pipeline`/`get_meeting_diarizer`/`get_summarizer`로 통일, 라우터에서 동일 이름 사용. 상수 별칭(`_SAMPLE_RATE` 등) 기존 참조 유지.

**위험 노트:**
- Phase 4(라우터 분리)는 `app.state` → `request.app.state` 전환이 누락되면 런타임 AttributeError. 각 라우터 분리 직후 해당 도메인 테스트를 콕 집어 실행.
- Phase 5는 효과 대비 위험이 높음 — Phase 1~4만으로도 목표(중복/죽은코드 제거 + god파일 분리) 대부분 달성. Phase 5는 사용자 재확인 후 진행 권장.
