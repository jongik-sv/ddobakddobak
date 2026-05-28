# STT 회의 언어 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 언어를 "단일 언어 강제(정확)" / "다국어 자동감지+필터" 두 모드로 제공하고, Qwen3-ASR이 ISO 코드를 못 알아들어 엉뚱한 언어(중국어·일본어·힌디어)로 환각하던 버그를 고친다.

**Architecture:** sidecar에 언어 코드 변환/필터 공용 모듈(`lang_utils.py`)을 두고, 각 STT 어댑터는 `mode`에 따라 (single→엔진별 포맷으로 언어 강제 / multi→자동감지하고 감지언어를 세그먼트에 기록)만 담당한다. 감지언어 필터는 `main.py`에서 중앙 집중 처리(DRY). 설정은 전역(`settings.yaml` + ENV)이며 `language_mode` 필드를 추가한다.

**Tech Stack:** Python(FastAPI, pytest) sidecar / Rails(rspec) backend / React+TypeScript(zustand, vitest) frontend.

**참고 스펙:** `docs/superpowers/specs/2026-05-28-stt-meeting-language-mode-design.md`

**핵심 사실(코드 조사 결과):**
- 실시간 STT 엔진은 플랫폼별 자동선택(`factory.py:auto_select_engine`). Apple Silicon → `qwen3_asr_8bit`(mlx, `Qwen3Adapter`). CUDA → `qwen3_asr_transformers`. 그 외 → `whisper_cpp`.
- 파일 업로드 STT는 **항상 Whisper**로 처리됨(`main.py:412-419`). 즉 파일 경로는 `WhisperAdapter` 사용.
- `TranscriptSegment`(`base.py:7`)에 `language: str` 필드가 이미 있음 → 필터 기준으로 활용.
- Qwen3 모델 `support_languages`는 영어 풀네임(`Korean`,`Chinese`...). ISO 코드(`ko`) 미포함.

---

## File Structure

신규:
- `sidecar/app/stt/lang_utils.py` — ISO↔Qwen 풀네임 매핑, 모드별 엔진 언어 결정, 감지언어 정규화/필터.
- `sidecar/tests/test_lang_utils.py` — 단위테스트.

수정(sidecar):
- `sidecar/app/stt/base.py` — `transcribe` 시그니처에 `mode` 추가.
- `sidecar/app/stt/qwen3_adapter.py` — single 풀네임 강제, multi 감지언어 기록.
- `sidecar/app/stt/qwen3_transformers_adapter.py` — `language=None` 하드코딩 제거, single 강제 / multi 감지언어.
- `sidecar/app/stt/whisper_adapter.py` — single ISO 강제, multi `auto_detect_language`로 감지언어 기록.
- `sidecar/app/stt/faster_whisper_adapter.py` — single ISO 강제, multi `info.language` 기록.
- `sidecar/app/main.py` — 요청 스키마에 `mode`, 어댑터 호출에 전달, 감지언어 필터 중앙 적용.

수정(backend):
- `backend/app/services/sidecar_client.rb` — `transcribe`/`transcribe_file`에 `mode:`.
- `backend/app/jobs/transcription_job.rb` — `mode:` 파라미터 전달.
- `backend/app/channels/transcription_channel.rb` — `data["mode"]` 전달.
- `backend/app/jobs/file_transcription_job.rb` — ENV `LANGUAGE_MODE` 읽어 전달.
- `backend/app/controllers/api/v1/settings_controller.rb` — `language_mode` 읽기/저장/ENV 동기화.

수정(frontend):
- `frontend/src/api/settings.ts` — `AppSettings.language_mode`.
- `frontend/src/stores/appSettingsStore.ts` — `languageMode` 상태/세터/저장/로드.
- `frontend/src/channels/transcription.ts` — `sendAudioChunk` payload에 `mode`.
- `frontend/src/hooks/useTranscription.ts` — `mode` 캐시 후 전달.
- `frontend/src/components/settings/SettingsContent.tsx` — 라디오 + 조건부 드롭다운/체크박스 + 안내문구.

---

## Phase 1 — sidecar 언어 유틸 (핵심 토대)

### Task 1: `lang_utils.py` 공용 모듈

**Files:**
- Create: `sidecar/app/stt/lang_utils.py`
- Test: `sidecar/tests/test_lang_utils.py`

- [ ] **Step 1: 실패 테스트 작성**

Create `sidecar/tests/test_lang_utils.py`:
```python
from app.stt import lang_utils as lu


def test_qwen_force_lang_single_maps_iso_to_fullname():
    assert lu.qwen_force_lang(["ko"], "single") == "Korean"
    assert lu.qwen_force_lang(["en"], "single") == "English"


def test_qwen_force_lang_unknown_iso_falls_back_to_korean():
    assert lu.qwen_force_lang(["xx"], "single") == "Korean"


def test_qwen_force_lang_multi_returns_none():
    assert lu.qwen_force_lang(["ko", "en"], "multi") is None


def test_qwen_force_lang_empty_returns_none():
    assert lu.qwen_force_lang([], "single") is None
    assert lu.qwen_force_lang(None, "single") is None


def test_iso_force_lang_single_returns_iso():
    assert lu.iso_force_lang(["ko"], "single") == "ko"


def test_iso_force_lang_multi_returns_none():
    assert lu.iso_force_lang(["ko", "en"], "multi") is None


def test_normalize_to_iso_from_fullname():
    assert lu.normalize_to_iso("Korean") == "ko"
    assert lu.normalize_to_iso("Chinese") == "zh"


def test_normalize_to_iso_passthrough_iso():
    assert lu.normalize_to_iso("ko") == "ko"


def test_normalize_to_iso_unknown_lowercased():
    assert lu.normalize_to_iso("auto") == "auto"


def test_filter_segments_drops_unlisted_language():
    class Seg:
        def __init__(self, text, language):
            self.text = text
            self.language = language

    segs = [Seg("안녕", "Korean"), Seg("nihao", "Chinese"), Seg("hi", "en")]
    kept = lu.filter_segments(segs, ["ko", "en"])
    assert [s.text for s in kept] == ["안녕", "hi"]


def test_filter_segments_empty_allowed_keeps_all():
    class Seg:
        def __init__(self, language):
            self.language = language

    segs = [Seg("Chinese"), Seg("Korean")]
    assert lu.filter_segments(segs, []) == segs
    assert lu.filter_segments(segs, None) == segs
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_lang_utils.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.stt.lang_utils'`

- [ ] **Step 3: 모듈 구현**

Create `sidecar/app/stt/lang_utils.py`:
```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_lang_utils.py -v`
Expected: PASS (11 passed)

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/stt/lang_utils.py sidecar/tests/test_lang_utils.py
git commit -m "feat(stt): add lang_utils for ISO<->Qwen mapping and detected-language filter"
```

---

## Phase 2 — sidecar 어댑터 + main.py

### Task 2: base 인터페이스 + Qwen mlx 어댑터

**Files:**
- Modify: `sidecar/app/stt/base.py:42-53`
- Modify: `sidecar/app/stt/qwen3_adapter.py`
- Test: `sidecar/tests/test_qwen3_adapter_lang.py`

- [ ] **Step 1: 실패 테스트 작성**

Create `sidecar/tests/test_qwen3_adapter_lang.py`:
```python
import numpy as np
import pytest

from app.stt.qwen3_adapter import Qwen3Adapter


class _FakeResult:
    def __init__(self, text, language):
        self.text = text
        self.language = language  # mlx STTOutput.language 는 세그먼트별 리스트


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def generate(self, audio_array, language=None):
        self.last_language = language
        # 자동감지(None)면 중국어가 감지되었다고 가정
        detected = language if language else "Chinese"
        return _FakeResult("nihao", [detected])


@pytest.fixture
def adapter():
    a = Qwen3Adapter()
    a._model = _FakeModel()
    a._is_loaded = True
    return a


def _pcm(seconds=1.0):
    return (np.zeros(int(16000 * seconds), dtype=np.int16)).tobytes()


@pytest.mark.asyncio
async def test_single_mode_forces_fullname(adapter):
    await adapter.transcribe(_pcm(), languages=["ko"], mode="single")
    assert adapter._model.last_language == "Korean"


@pytest.mark.asyncio
async def test_multi_mode_passes_none_and_records_detected_iso(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language is None
    assert segs and segs[0].language == "zh"  # Chinese → 정규화 zh
```

> 참고: `is_hallucination("nihao", [...])`가 빈 결과를 만들면 안 되므로 무음이 아닌 텍스트를 쓴다. 만약 환각 필터에 걸리면 테스트 텍스트를 `"테스트 발화"` 등 한국어로 바꾸고 detected만 검증하도록 조정한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_qwen3_adapter_lang.py -v`
Expected: FAIL — `transcribe()` got an unexpected keyword argument 'mode' (또는 `last_language`가 "ko").

- [ ] **Step 3: base 시그니처 수정**

In `sidecar/app/stt/base.py`, replace the abstract `transcribe` (lines 42-53):
```python
    @abstractmethod
    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """오디오 청크(bytes) → 텍스트 세그먼트 변환 (동기 배치).

        Args:
            audio_chunk: PCM 16kHz mono Int16 바이너리 데이터
            languages: 인식 대상 언어 코드 목록(ISO, 예: ["ko", "ja"]).
            mode: "single"이면 languages[0]로 인식 언어를 강제하고,
                  "multi"이면 자동 감지 후 감지언어를 세그먼트에 기록한다.

        Returns:
            TranscriptSegment 리스트 (빈 리스트 가능)
        """
        ...
```

- [ ] **Step 4: Qwen mlx 어댑터 수정**

In `sidecar/app/stt/qwen3_adapter.py`, add import near top (after existing imports):
```python
from app.stt import lang_utils
```

Replace `transcribe` (lines 44-78) and `_run_inference`/`_infer` (lines 80-88) with:
```python
    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        """PCM 오디오 청크를 텍스트 세그먼트로 변환한다.

        single 모드: languages[0]을 Qwen 풀네임으로 변환하여 인식 언어 강제.
        multi 모드: 자동감지(language=None) 후 감지언어를 세그먼트에 기록(필터는 main에서).
        """
        if not self._is_loaded:
            raise RuntimeError(
                "모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요."
            )

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        chunk_duration_ms = int(len(audio_array) / _SAMPLE_RATE * 1000)
        engine_lang = lang_utils.qwen_force_lang(languages, mode)  # 풀네임 or None

        text, detected = await self._run_inference(audio_array, engine_lang)
        if not text or not text.strip() or is_hallucination(text, languages):
            return []

        # single이면 강제 언어(ISO), multi면 감지언어(ISO 정규화)
        seg_lang = (
            lang_utils.normalize_to_iso(detected)
            if mode == "multi"
            else (languages[0] if languages else "ko")
        )

        return [
            TranscriptSegment(
                text=text.strip(),
                started_at_ms=0,
                ended_at_ms=max(chunk_duration_ms, 1000),
                language=seg_lang,
                confidence=0.9,
            )
        ]

    async def _run_inference(self, audio_array: np.ndarray, language: str | None) -> tuple[str, str | None]:
        """mlx-audio 추론 실행. (text, 감지언어) 반환."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, language)

    def _infer(self, audio_array: np.ndarray, language: str | None) -> tuple[str, str | None]:
        """동기 mlx-audio 추론. result.language(리스트/문자열)에서 감지언어 추출."""
        result = self._model.generate(audio_array, language=language)
        text = result.text if hasattr(result, "text") else str(result)
        detected = None
        lang_attr = getattr(result, "language", None)
        if isinstance(lang_attr, list) and lang_attr:
            detected = lang_attr[0]
        elif isinstance(lang_attr, str):
            detected = lang_attr
        return text, detected
```

> `transcribe_stream`은 `self.transcribe(chunk)` 호출이라 기본값 mode="single"로 동작 — 변경 불필요.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_qwen3_adapter_lang.py -v`
Expected: PASS (2 passed). 만약 `is_hallucination`에 걸려 빈 리스트면 Step 1 참고로 텍스트 조정 후 재실행.

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/stt/base.py sidecar/app/stt/qwen3_adapter.py sidecar/tests/test_qwen3_adapter_lang.py
git commit -m "fix(stt): qwen mlx adapter force language by fullname, record detected lang in multi"
```

---

### Task 3: Qwen transformers 어댑터 (CUDA)

**Files:**
- Modify: `sidecar/app/stt/qwen3_transformers_adapter.py`

- [ ] **Step 1: 현재 코드 확인**

Run: `cd sidecar && sed -n '100,210p' app/stt/qwen3_transformers_adapter.py`
Expected: `transcribe(self, audio_chunk, languages=...)` 와 `self._model.transcribe(audio=..., language=None)` 3곳(`_infer_from_pcm`, file 계열) 확인.

- [ ] **Step 2: import 추가**

In `sidecar/app/stt/qwen3_transformers_adapter.py`, add near other imports:
```python
from app.stt import lang_utils
```

- [ ] **Step 3: transcribe 시그니처에 mode 추가 + 엔진 언어 결정**

Find the `async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None)` (around line 103) and change signature to:
```python
    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single") -> list[TranscriptSegment]:
```
Inside it, compute the engine language once and pass into the PCM inference path:
```python
        engine_lang = lang_utils.qwen_force_lang(languages, mode)
```
Replace the call that runs inference (currently `return await loop.run_in_executor(None, self._infer_from_pcm, audio_array)` near line 133) so the engine language and mode flow in:
```python
        return await loop.run_in_executor(None, self._infer_from_pcm, audio_array, engine_lang, languages, mode)
```

- [ ] **Step 4: `_infer_from_pcm`에서 강제/감지 적용**

Find `_infer_from_pcm` (the method doing `self._model.transcribe(audio=tmp.name, language=None)` around line 141) and update it to accept the new args and set per-segment language:
```python
    def _infer_from_pcm(self, audio_array, engine_lang, languages, mode):
        # ... 기존 tmp 파일 생성 코드 유지 ...
        results = self._model.transcribe(audio=tmp.name, language=engine_lang)
        segments = []
        for r in results:
            text = r.text.strip()
            if not text or is_hallucination(text, languages):
                continue
            seg_lang = (
                lang_utils.normalize_to_iso(r.language)
                if mode == "multi"
                else (languages[0] if languages else "ko")
            )
            segments.append(TranscriptSegment(
                text=text,
                started_at_ms=int(getattr(r, "start", 0) * 1000),
                ended_at_ms=int(getattr(r, "end", 0) * 1000),
                language=seg_lang,
                confidence=0.9,
            ))
        return segments
```

> 실제 필드명(`r.text`, `r.start`, `r.end`, `r.language`)은 Step 1 출력으로 확인해 기존 코드와 일치시킨다. file 계열 메서드(`language=None` 나머지 2곳)는 main.py가 파일 경로에 Whisper를 쓰므로 동작 경로 밖이지만, 일관성을 위해 동일하게 `engine_lang` 사용으로 바꿔두되 시그니처에 `mode="single"` 기본을 추가한다.

- [ ] **Step 5: 임포트/구문 검증**

Run: `cd sidecar && uv run python -c "import app.stt.qwen3_transformers_adapter"`
Expected: 출력 없음(임포트 성공). torch/transformers 미설치로 ImportError가 나면 해당 환경에선 검증 생략(런타임 CUDA 전용).

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/stt/qwen3_transformers_adapter.py
git commit -m "fix(stt): qwen transformers adapter honor language mode (remove hardcoded None)"
```

---

### Task 4: whisper_cpp 어댑터

**Files:**
- Modify: `sidecar/app/stt/whisper_adapter.py`
- Test: `sidecar/tests/test_whisper_adapter_lang.py`

- [ ] **Step 1: 실패 테스트 작성**

Create `sidecar/tests/test_whisper_adapter_lang.py`:
```python
import numpy as np
import pytest

from app.stt.whisper_adapter import WhisperAdapter


class _Seg:
    def __init__(self, text, t0=0, t1=100):
        self.text = text
        self.t0 = t0
        self.t1 = t1


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def transcribe(self, audio_array, language="auto"):
        self.last_language = language
        return [_Seg("안녕하세요")]

    def auto_detect_language(self, audio_array):
        # ((detected, prob), all_probs)
        return (("zh", 0.9), {})


@pytest.fixture
def adapter():
    a = WhisperAdapter()
    a._model = _FakeModel()
    a._is_loaded = True
    return a


def _pcm():
    return np.zeros(16000, dtype=np.int16).tobytes()


@pytest.mark.asyncio
async def test_single_mode_forces_iso(adapter):
    await adapter.transcribe(_pcm(), languages=["ko"], mode="single")
    assert adapter._model.last_language == "ko"


@pytest.mark.asyncio
async def test_multi_mode_auto_and_records_detected(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language == "auto"
    assert segs and segs[0].language == "zh"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_whisper_adapter_lang.py -v`
Expected: FAIL — unexpected keyword 'mode'.

- [ ] **Step 3: 어댑터 수정**

In `sidecar/app/stt/whisper_adapter.py`, add import:
```python
from app.stt import lang_utils
```
Replace `transcribe` (lines 54-77) and `_run_inference` (lines 79-86) with:
```python
    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        if not self._is_loaded:
            raise RuntimeError("모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요.")

        engine_lang = lang_utils.iso_force_lang(languages, mode)  # ISO or None
        audio_array = pcm_bytes_to_float32(audio_chunk)

        # multi 모드: 자동감지 + 청크 감지언어 추출
        detected = None
        if mode == "multi":
            detected = await self._detect_language(audio_array)

        raw_segments = await self._run_inference(audio_array, language=engine_lang)
        seg_lang = detected if mode == "multi" else (languages[0] if languages else "ko")
        return [
            _to_transcript_segment(seg, language=seg_lang)
            for seg in raw_segments
            if seg.text.strip() and not is_hallucination(seg.text, languages)
        ]

    async def _detect_language(self, audio_array) -> str | None:
        """whisper.cpp 언어 자동감지 (ISO 코드 반환). 실패 시 None."""
        loop = asyncio.get_running_loop()
        try:
            (lang, _prob), _all = await loop.run_in_executor(
                None, lambda: self._model.auto_detect_language(audio_array)
            )
            return lang
        except Exception:
            return None

    async def _run_inference(self, audio_array, language: str | None = None) -> list:
        """pywhispercpp 추론 실행 (blocking → executor 비동기화)."""
        loop = asyncio.get_running_loop()
        lang = language or "auto"
        return await loop.run_in_executor(
            None,
            lambda: self._model.transcribe(audio_array, language=lang),
        )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_whisper_adapter_lang.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/stt/whisper_adapter.py sidecar/tests/test_whisper_adapter_lang.py
git commit -m "feat(stt): whisper_cpp adapter language mode + detected-language capture"
```

---

### Task 5: faster_whisper 어댑터

**Files:**
- Modify: `sidecar/app/stt/faster_whisper_adapter.py`
- Test: `sidecar/tests/test_faster_whisper_adapter_lang.py`

- [ ] **Step 1: 실패 테스트 작성**

Create `sidecar/tests/test_faster_whisper_adapter_lang.py`:
```python
import numpy as np
import pytest

from app.stt.faster_whisper_adapter import FasterWhisperAdapter


class _Seg:
    def __init__(self, text, start=0.0, end=0.1, avg_logprob=-0.1):
        self.text = text
        self.start = start
        self.end = end
        self.avg_logprob = avg_logprob


class _Info:
    def __init__(self, language):
        self.language = language


class _FakeModel:
    def __init__(self):
        self.last_language = "UNSET"

    def transcribe(self, audio, language=None, vad_filter=True):
        self.last_language = language
        return iter([_Seg("안녕하세요")]), _Info("zh")


@pytest.fixture
def adapter():
    a = FasterWhisperAdapter()
    a._model = _FakeModel()
    a._is_loaded = True
    return a


def _pcm():
    return np.zeros(16000, dtype=np.int16).tobytes()


@pytest.mark.asyncio
async def test_single_mode_forces_iso(adapter):
    await adapter.transcribe(_pcm(), languages=["ko"], mode="single")
    assert adapter._model.last_language == "ko"


@pytest.mark.asyncio
async def test_multi_mode_records_info_language(adapter):
    segs = await adapter.transcribe(_pcm(), languages=["ko", "en"], mode="multi")
    assert adapter._model.last_language is None
    assert segs and segs[0].language == "zh"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_faster_whisper_adapter_lang.py -v`
Expected: FAIL — unexpected keyword 'mode'.

- [ ] **Step 3: 어댑터 수정**

In `sidecar/app/stt/faster_whisper_adapter.py`, add import:
```python
from app.stt import lang_utils
```
Replace `transcribe` (lines 55-70) and `_run_inference`/`_infer` (lines 72-94) with:
```python
    async def transcribe(
        self, audio_chunk: bytes, languages: list[str] | None = None, mode: str = "single"
    ) -> list[TranscriptSegment]:
        if not self._is_loaded:
            raise RuntimeError("모델이 로드되지 않았습니다. load_model()을 먼저 호출하세요.")

        audio_array = pcm_bytes_to_float32(audio_chunk)
        if len(audio_array) == 0:
            return []

        raw_segments = await self._run_inference(audio_array, languages=languages, mode=mode)
        return [
            seg for seg in raw_segments
            if seg.text.strip() and not is_hallucination(seg.text, languages)
        ]

    async def _run_inference(self, audio_array, languages, mode) -> list[TranscriptSegment]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._infer, audio_array, languages, mode)

    def _infer(self, audio_array, languages, mode) -> list[TranscriptSegment]:
        engine_lang = lang_utils.iso_force_lang(languages, mode)  # ISO or None
        segments_iter, info = self._model.transcribe(
            audio_array,
            language=engine_lang,
            vad_filter=True,
        )
        detected = getattr(info, "language", None)
        results = []
        for seg in segments_iter:
            seg_lang = detected if mode == "multi" else (languages[0] if languages else "ko")
            results.append(TranscriptSegment(
                text=seg.text.strip(),
                started_at_ms=int(seg.start * 1000),
                ended_at_ms=int(seg.end * 1000),
                language=seg_lang or "ko",
                confidence=seg.avg_logprob if seg.avg_logprob else 0.0,
            ))
        return results
```

> `transcribe_file`(별도 메서드)는 main.py 파일 경로에서 쓰이지 않음(파일도 `transcribe` 사용). 변경 불필요.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_faster_whisper_adapter_lang.py -v`
Expected: PASS (2 passed). faster_whisper 미설치 환경이면 import 단계에서 skip — 그 경우 `uv sync --extra cuda` 필요하거나 CI에서만 검증.

- [ ] **Step 5: 커밋**

```bash
git add sidecar/app/stt/faster_whisper_adapter.py sidecar/tests/test_faster_whisper_adapter_lang.py
git commit -m "feat(stt): faster_whisper adapter language mode + info.language capture"
```

---

### Task 6: main.py — 요청 스키마 + 필터 중앙 적용

**Files:**
- Modify: `sidecar/app/main.py` (요청 스키마 138-143, 173-180 / `transcribe` 367-369 / `transcribe-file` 412-440 / `_chunked_transcribe` ~510-536)

- [ ] **Step 1: import + 요청 스키마에 mode 추가**

In `sidecar/app/main.py`, add near the STT imports (top of file with other `from app.stt...`):
```python
from app.stt import lang_utils
```
In `TranscribeRequest` (after line 143 `offset_ms`):
```python
    mode: str = "single"  # "single"=언어 강제 / "multi"=자동감지+감지언어 필터
```
In `TranscribeFileRequest` (after line 179 `file_chunk_sec`):
```python
    mode: str = "single"
```

- [ ] **Step 2: `/transcribe`에서 mode 전달 + 필터**

Replace lines 367-369:
```python
    langs = request.languages
    mode = request.mode
    async with app.state.gpu_lock:
        segments = await adapter.transcribe(audio_bytes, languages=langs, mode=mode)
        if mode == "multi":
            segments = lang_utils.filter_segments(segments, langs)
        if diarizer and segments:
```

- [ ] **Step 3: `/transcribe-file`에서 mode 전달 + 필터**

In `transcribe_file`, change the chunked/non-chunked calls (lines 427-434) to pass `mode=request.mode`:
```python
        if chunk_sec > 0:
            print(f"[transcribe-file] 청크 분할 모드 ({chunk_sec}초)", flush=True)
            segments = await _chunked_transcribe(
                file_adapter, audio_bytes,
                chunk_sec=chunk_sec, overlap_sec=2,
                languages=request.languages,
                mode=request.mode,
            )
        else:
            segments = await file_adapter.transcribe(
                audio_bytes, languages=request.languages, mode=request.mode
            )
```
Then after `print(f"[transcribe-file] STT 세그먼트 {len(segments)}개", ...)` (line 440), add filter before diarization:
```python
    if request.mode == "multi":
        segments = lang_utils.filter_segments(segments, request.languages)
        print(f"[transcribe-file] 언어 필터 후 {len(segments)}개", flush=True)
```

- [ ] **Step 4: `_chunked_transcribe`에 mode 전달**

Run: `cd sidecar && sed -n '505,540p' app/main.py` to confirm signature/body.
Change the signature to add `mode: str = "single"` and the inner call `adapter.transcribe(chunk, languages=languages)` to `adapter.transcribe(chunk, languages=languages, mode=mode)`.

- [ ] **Step 5: 구문/임포트 검증 + 기존 STT 테스트 회귀**

Run: `cd sidecar && uv run python -c "import app.main"`
Expected: 임포트 성공.
Run: `cd sidecar && uv run pytest tests/ -v -k "lang or adapter"`
Expected: 신규 테스트 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add sidecar/app/main.py
git commit -m "feat(stt): thread language mode through endpoints and apply detected-language filter"
```

---

## Phase 3 — Rails 백엔드

### Task 7: SidecarClient에 mode 전달

**Files:**
- Modify: `backend/app/services/sidecar_client.rb:32-47`

- [ ] **Step 1: transcribe/transcribe_file 시그니처 + body 수정**

Replace lines 32-47:
```ruby
  def transcribe(audio_base64, meeting_id: nil, diarization_config: nil, languages: nil, mode: "single", offset_ms: 0)
    body = { audio: audio_base64, offset_ms: offset_ms }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    body[:languages] = languages if languages
    body[:mode] = mode if mode
    post("/transcribe", body)
  end

  def transcribe_file(file_path, meeting_id: nil, diarization_config: nil, languages: nil, mode: "single", file_chunk_sec: nil)
    body = { file_path: file_path }
    body[:meeting_id] = meeting_id if meeting_id
    body[:diarization_config] = diarization_config if diarization_config
    body[:languages] = languages if languages
    body[:mode] = mode if mode
    body[:file_chunk_sec] = file_chunk_sec if file_chunk_sec
    post("/transcribe-file", body, timeout: ENV.fetch("SIDECAR_TRANSCRIBE_FILE_TIMEOUT", "21600").to_i)
  end
```

- [ ] **Step 2: 구문 검증**

Run: `cd backend && bundle exec ruby -c app/services/sidecar_client.rb`
Expected: `Syntax OK`

- [ ] **Step 3: 커밋**

```bash
git add backend/app/services/sidecar_client.rb
git commit -m "feat(backend): pass language mode to sidecar transcribe calls"
```

---

### Task 8: TranscriptionJob + Channel에 mode 전달

**Files:**
- Modify: `backend/app/jobs/transcription_job.rb:9,17`
- Modify: `backend/app/channels/transcription_channel.rb:47-55`

- [ ] **Step 1: TranscriptionJob 수정**

In `transcription_job.rb`, change `perform` signature (line 9) to add `mode:`:
```ruby
  def perform(meeting_id:, audio_data:, sequence: 0, offset_ms: 0, diarization_config: nil, languages: nil, mode: "single", audio_source: "mic")
```
And the client call (line 17):
```ruby
    result = client.transcribe(audio_data, meeting_id: meeting_id, diarization_config: diarization_config, languages: languages, mode: mode, offset_ms: offset_ms)
```

- [ ] **Step 2: TranscriptionChannel 수정**

In `transcription_channel.rb`, add `mode:` to the `perform_later` call (after line 53):
```ruby
    TranscriptionJob.perform_later(
      meeting_id: @meeting_id,
      audio_data: data["data"].to_s,
      sequence: data["sequence"].to_i,
      offset_ms: data["offset_ms"].to_i,
      diarization_config: data["diarization_config"],
      languages: data["languages"],
      mode: data["mode"] || "single",
      audio_source: data["audio_source"] || "mic"
    )
```

- [ ] **Step 3: 구문 검증**

Run: `cd backend && bundle exec ruby -c app/jobs/transcription_job.rb && bundle exec ruby -c app/channels/transcription_channel.rb`
Expected: `Syntax OK` x2

- [ ] **Step 4: 커밋**

```bash
git add backend/app/jobs/transcription_job.rb backend/app/channels/transcription_channel.rb
git commit -m "feat(backend): thread language mode from channel through transcription job"
```

---

### Task 9: FileTranscriptionJob — ENV LANGUAGE_MODE

**Files:**
- Modify: `backend/app/jobs/file_transcription_job.rb:15-29`

- [ ] **Step 1: mode 읽어 전달**

In `file_transcription_job.rb`, after line 15 (`languages = ...`), add:
```ruby
    mode = ENV.fetch("LANGUAGE_MODE", "single")
```
And in the `SidecarClient.new.transcribe_file(...)` call (lines 18-29), add `mode: mode,` after `languages: languages,`:
```ruby
    result = SidecarClient.new.transcribe_file(
      pcm_path,
      meeting_id: meeting.id,
      languages: languages,
      mode: mode,
      file_chunk_sec: file_chunk_sec,
      diarization_config: {
        ...
      }
    )
```

- [ ] **Step 2: 구문 검증**

Run: `cd backend && bundle exec ruby -c app/jobs/file_transcription_job.rb`
Expected: `Syntax OK`

- [ ] **Step 3: 커밋**

```bash
git add backend/app/jobs/file_transcription_job.rb
git commit -m "feat(backend): file transcription reads LANGUAGE_MODE from env"
```

---

### Task 10: settings_controller — language_mode 저장/로드/ENV

**Files:**
- Modify: `backend/app/controllers/api/v1/settings_controller.rb` (app_settings 170-171, update_app_settings 200-205, sync 295-297)
- Test: `backend/spec/requests/api/v1/settings_app_language_mode_spec.rb` (있으면 패턴 따름)

- [ ] **Step 1: app_settings 응답에 language_mode 추가**

After line 171 (`result["selected_languages"] = ...`):
```ruby
        result["language_mode"] = cfg.dig("languages", "mode") if cfg.dig("languages", "mode")
```

- [ ] **Step 2: update_app_settings에서 language_mode 저장**

Inside the `# languages` block (after line 205, still inside the method), add:
```ruby
        if params.key?(:language_mode)
          cfg["languages"] ||= {}
          mode = params[:language_mode].to_s
          cfg["languages"]["mode"] = %w[single multi].include?(mode) ? mode : "single"
        end
```

- [ ] **Step 3: ENV 동기화에 LANGUAGE_MODE 추가**

In `sync_active_llm_to_env`, after the `SELECTED_LANGUAGES` block (line 295-297):
```ruby
        if (mode = cfg.dig("languages", "mode"))
          ENV["LANGUAGE_MODE"] = mode.to_s
        end
```

- [ ] **Step 4: 구문 검증 + (있으면) 요청 스펙**

Run: `cd backend && bundle exec ruby -c app/controllers/api/v1/settings_controller.rb`
Expected: `Syntax OK`
선택: 기존 settings 요청 스펙이 있으면 language_mode round-trip 케이스 추가 후 `bundle exec rspec spec/requests/api/v1/settings*`.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/settings_controller.rb
git commit -m "feat(backend): persist and sync language_mode in app settings"
```

---

## Phase 4 — 프론트엔드

### Task 11: api/settings.ts 타입

**Files:**
- Modify: `frontend/src/api/settings.ts:87-102`

- [ ] **Step 1: AppSettings에 language_mode 추가**

In the `AppSettings` interface (after line 90 `selected_languages?`):
```ts
  language_mode?: 'single' | 'multi'
```

- [ ] **Step 2: 타입체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: 에러 없음(또는 기존과 동일).

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/api/settings.ts
git commit -m "feat(frontend): add language_mode to AppSettings type"
```

---

### Task 12: appSettingsStore — languageMode 상태

**Files:**
- Modify: `frontend/src/stores/appSettingsStore.ts`

- [ ] **Step 1: 상태/세터 인터페이스 추가**

In `AppSettingsState` (after line 42 `toggleLanguage`):
```ts
  /** 언어 인식 모드: single=단일 강제, multi=다국어 자동감지 */
  languageMode: 'single' | 'multi'
  setLanguageMode: (mode: 'single' | 'multi') => void
  setSingleLanguage: (code: string) => void
```

- [ ] **Step 2: 저장 payload에 language_mode 포함**

In `debouncedSave`, extend the payload (after line 54 `selected_languages`):
```ts
      language_mode: s.languageMode,
```

- [ ] **Step 3: 초기값 + 구현 추가**

In the store body (after the `toggleLanguage` block, around line 112), add:
```ts
    languageMode: 'single',
    setLanguageMode: (mode) => { set({ languageMode: mode }); debouncedSave() },
    setSingleLanguage: (code) => { set({ selectedLanguages: [code] }); debouncedSave() },
```

- [ ] **Step 4: loadAppSettings에서 로드**

In `loadAppSettings`, after line 123 (`if (saved.selected_languages?.length) ...`):
```ts
    if (saved.language_mode === 'single' || saved.language_mode === 'multi') {
      updates.languageMode = saved.language_mode
    }
```

- [ ] **Step 5: 타입체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/stores/appSettingsStore.ts
git commit -m "feat(frontend): language mode state in app settings store"
```

---

### Task 13: 채널/훅에서 mode 전달

**Files:**
- Modify: `frontend/src/channels/transcription.ts:203-228`
- Modify: `frontend/src/hooks/useTranscription.ts:29-62`

- [ ] **Step 1: sendAudioChunk에 mode 인자 추가**

In `transcription.ts`, change the signature (lines 203-210) to add `mode?: string` after `languages`:
```ts
export function sendAudioChunk(
  subscription: Subscription,
  pcm: Int16Array,
  meta?: { sequence: number; offsetMs: number },
  diarizationConfig?: Record<string, unknown>,
  languages?: string[],
  audioSource?: 'mic' | 'system',
  mode?: string,
): void {
```
And in the payload build (after line 223 `payload.languages = languages`):
```ts
  if (mode) {
    payload.mode = mode
  }
```

- [ ] **Step 2: useTranscription에서 mode 캐시 + 전달**

In `useTranscription.ts`, add a ref (after line 29 `languagesRef`):
```ts
  const modeRef = useRef<string>('single')
```
In the init effect set/subscribe (lines 33-40), set it:
```ts
    languagesRef.current = state.selectedLanguages
    modeRef.current = state.languageMode

    return useAppSettingsStore.subscribe((s) => {
      diarizationConfigRef.current = buildDiarizationConfig(s)
      languagesRef.current = s.selectedLanguages
      modeRef.current = s.languageMode
    })
```
And in `send` (line 60), pass it:
```ts
      sendAudioChunk(subscriptionRef.current, pcm, meta, diarizationConfigRef.current, languagesRef.current, source, modeRef.current)
```

- [ ] **Step 3: 타입체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/channels/transcription.ts frontend/src/hooks/useTranscription.ts
git commit -m "feat(frontend): send language mode with audio chunks"
```

---

### Task 14: SettingsContent UI — 라디오 + 조건부 + 안내

**Files:**
- Modify: `frontend/src/components/settings/SettingsContent.tsx` (스토어 셀렉터 ~292, 언어 블록 405-438)

- [ ] **Step 1: 스토어에서 새 값 가져오기**

Find where `selectedLanguages, toggleLanguage` are read from the store (around line 292) and extend to:
```ts
  const selectedLanguages = useAppSettingsStore((s) => s.selectedLanguages)
  const toggleLanguage = useAppSettingsStore((s) => s.toggleLanguage)
  const languageMode = useAppSettingsStore((s) => s.languageMode)
  const setLanguageMode = useAppSettingsStore((s) => s.setLanguageMode)
  const setSingleLanguage = useAppSettingsStore((s) => s.setSingleLanguage)
```
> 기존 구독 방식이 `const { selectedLanguages, toggleLanguage } = useAppSettingsStore()` 형태면 동일 스타일로 항목만 추가한다.

- [ ] **Step 2: 언어 블록 교체**

Replace the 회의 언어 block (lines 405-438) with:
```tsx
      {/* 회의 언어 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 언어</h2>
        <p className="text-sm text-muted-foreground mb-4">
          회의에서 사용하는 언어 인식 방식을 선택합니다.
        </p>

        {/* 모드 라디오 */}
        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="radio"
              name="language_mode"
              checked={languageMode === 'single'}
              onChange={() => setLanguageMode('single')}
              className="accent-blue-600 w-4 h-4 mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">단일 언어 (정확) — 권장</span>
              <span className="block text-xs text-muted-foreground">한 가지 언어로 고정 인식. 인식 정확도가 가장 높습니다.</span>
            </span>
          </label>

          {languageMode === 'single' && (
            <div className="ml-7">
              <select
                value={selectedLanguages[0] ?? 'ko'}
                onChange={(e) => setSingleLanguage(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>{lang.label} ({lang.code})</option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <input
              type="radio"
              name="language_mode"
              checked={languageMode === 'multi'}
              onChange={() => setLanguageMode('multi')}
              className="accent-blue-600 w-4 h-4 mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">다국어 자동감지</span>
              <span className="block text-xs text-muted-foreground">선택한 언어들을 자동 감지. 목록 밖 언어는 걸러냅니다.</span>
            </span>
          </label>

          {languageMode === 'multi' && (
            <div className="ml-7 space-y-2">
              {LANGUAGES.map((lang) => {
                const checked = selectedLanguages.includes(lang.code)
                const isOnly = checked && selectedLanguages.length === 1
                return (
                  <label key={lang.code} className="flex items-center gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isOnly}
                      onChange={() => toggleLanguage(lang.code)}
                      className="accent-blue-600 w-4 h-4"
                    />
                    <span className="text-sm font-medium">{lang.label}</span>
                    <span className="text-xs text-muted-foreground">({lang.code})</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          ℹ️ 한국어로만 진행하는 회의는 <strong>단일 언어(한국어)</strong>를 선택하면 인식 정확도가 더 높습니다.
          다국어 모드는 다른 언어가 섞여 인식될 수 있습니다.
        </p>
      </div>
```

- [ ] **Step 3: 타입체크 + 빌드**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/settings/SettingsContent.tsx
git commit -m "feat(frontend): meeting language mode UI (single/multi) with guidance"
```

---

## 통합 검증 (수동)

- [ ] sidecar 재기동(Apple Silicon → qwen3 엔진). 설정에서 **단일 언어(한국어)** 선택.
- [ ] 한국어 회의 녹음 → 트랜스크립트에 중국어/일본어/힌디어가 더 이상 안 섞이는지 확인.
- [ ] **다국어 자동감지**로 한국어+English 선택 → 한·영은 인식, 그 외 언어 세그먼트는 필터로 제거되는지 확인.
- [ ] 파일 업로드 STT도 동일하게 동작(서버 모드는 `SERVER_MODE=true`, `LANGUAGE_MODE` ENV 반영 위해 설정 저장 후 확인).
- [ ] 설정 새로고침 시 모드/언어가 유지되는지(round-trip) 확인.

## Self-Review 결과(작성자 점검)

- 스펙 커버리지: §1 데이터모델→Task10/12, §2 UI→Task14, §3 데이터흐름→Task6/7/8/9/13, §4 엔진로직→Task1~6, §5 엣지(필터 전체드롭/whisper 감지/미매핑 폴백)→lang_utils + 어댑터, §6 테스트→Task1~6 단위테스트. 누락 없음.
- 플레이스홀더: 없음(코드 블록 제공). 단 Task3은 transformers 실제 필드명 확인 단계를 명시.
- 타입 일관성: `qwen_force_lang`/`iso_force_lang`/`normalize_to_iso`/`filter_segments` 시그니처가 Task1 정의와 Task2~6 사용처 일치. `mode` 기본값 `"single"`로 base/어댑터/스키마/Rails/프론트 전 구간 통일.
