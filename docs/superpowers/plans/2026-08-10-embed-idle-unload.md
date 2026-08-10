# KURE 임베딩 유휴 언로드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KURE 임베딩 인코더가 유휴 시 STT와 동일한 2단계 정책으로 GPU와 RAM을 모두 반납하게 한다.

**Architecture:** 기존 `IdleOffloadController`(STT용 상태머신)를 `KureEncoder`에 재사용한다. 컨트롤러에 `initial_state` 파라미터를 추가해 lazy load 모델을 `UNLOADED`로 시작시키고, 인코더에 async 진입점 `encode_async`를 만들어 컨트롤러 락·복귀·`last_used` 갱신을 한 곳에서 처리한다. 백그라운드 점검 루프는 단일 STT 어댑터 참조 대신 `app.state.idle_managed` 목록을 순회한다.

**Tech Stack:** Python 3.11, FastAPI, PyTorch, transformers, pytest + pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-08-10-embed-idle-unload-design.md`

## Global Constraints

- 새 설정을 추가하지 않는다. TTL은 기존 `settings.STT_IDLE_UNLOAD_SEC`(600) / `settings.STT_IDLE_FULL_UNLOAD_SEC`(3600)을 공유한다.
- 기존 STT 유휴 오프로드 테스트가 회귀 없이 통과해야 한다. 베이스라인은 51 passed (`tests/test_idle_offload.py`, `tests/test_main_idle_offload.py`, `tests/test_qwen3_transformers_adapter_idle.py`, `tests/test_faster_whisper_adapter_idle.py`, `tests/test_embeddings_router.py`, `tests/test_embeddings_pool.py`).
- 테스트는 torch/CUDA 없이 돌아야 한다. 가짜 모델을 주입해 검증한다.
- 모든 블로킹 호출(텐서 이동, `gc.collect()`, 추론)은 `loop.run_in_executor(None, ...)`로 실행한다.
- 주석과 로그 메시지는 한국어로 쓴다 (기존 코드 컨벤션).
- 작업 디렉토리는 워크트리 `/home/ddobak/ddobakddobak/.claude/worktrees/embed-idle-unload`다. 모든 명령은 `sidecar/`에서 실행한다.
- 테스트 실행은 `.venv/bin/python -m pytest`를 쓴다 (`.venv`는 배포 디렉토리 심링크).

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `sidecar/app/stt/idle_offload.py` | 유휴 상태머신 (모델 비종속) | `initial_state` 파라미터 추가 |
| `sidecar/app/embeddings/encoder.py` | KURE 인코더 + 유휴 콜백 + async 진입점 | 컨트롤러 배선, `encode_async`, `maybe_offload` 위임 |
| `sidecar/app/routers/embeddings.py` | `/embed` 엔드포인트 | `encode_async` 호출, `embed_lock` 제거 |
| `sidecar/app/main.py` | 앱 조립 + 유휴 루프 | `idle_managed` 목록 등록, 루프 다중 대상화 |
| `sidecar/app/schemas.py` | 응답 스키마 | `HealthResponse.embed_state` 추가 |
| `sidecar/app/routers/health.py` | `/health` | `embed_state` 채우기 |
| `sidecar/tests/test_embeddings_idle.py` | 인코더 유휴 동작 테스트 | 신규 |
| `sidecar/tests/test_main_idle_offload.py` | 루프 배선 테스트 | 다중 대상 케이스로 갱신 |
| `sidecar/tests/test_embeddings_router.py` | 라우터 테스트 | async 스텁으로 갱신 |

---

### Task 1: IdleOffloadController에 initial_state 추가

lazy load 모델(KURE)은 첫 호출 전까지 메모리에 없다. 컨트롤러 기본 상태가 `GPU`이므로 그대로 쓰면 오프로드 루프가 존재하지 않는 모델을 CPU로 옮기려다 터진다. 초기 상태를 주입 가능하게 만든다.

**Files:**
- Modify: `sidecar/app/stt/idle_offload.py:102-126`
- Test: `sidecar/tests/test_idle_offload.py`

**Interfaces:**
- Produces: `IdleOffloadController(name, *, stage1_offload=None, stage1_target=ResidentState.CPU, reload_from_cpu=None, stage2_offload=None, reload_from_unloaded=None, clock=time.monotonic, initial_state=ResidentState.GPU)` — `initial_state`가 `self.state` 초기값이 된다. 기본값이 현행 동작과 같으므로 STT 어댑터는 변경 불필요.

- [ ] **Step 1: Write the failing test**

`sidecar/tests/test_idle_offload.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_initial_state_can_start_unloaded():
    """lazy load 모델용 — UNLOADED로 시작하면 1단계 오프로드가 발동하지 않는다."""
    clock = _FakeClock()
    stage1_calls = []

    async def _stage1():
        stage1_calls.append(1)

    ctl = IdleOffloadController(
        name="lazy",
        stage1_offload=_stage1,
        clock=clock,
        initial_state=ResidentState.UNLOADED,
    )

    assert ctl.state == ResidentState.UNLOADED
    assert ctl.gpu_resident is False

    clock.advance(10_000)
    await ctl.maybe_offload(600, 3600)

    assert stage1_calls == []          # 이미 최소 상태 — 오프로드 시도 없음
    assert ctl.state == ResidentState.UNLOADED


@pytest.mark.asyncio
async def test_initial_state_defaults_to_gpu():
    """기본값은 현행과 동일한 GPU — STT 어댑터 회귀 방지."""
    ctl = IdleOffloadController(name="default")
    assert ctl.state == ResidentState.GPU
```

파일 상단 import에 `ResidentState`가 없으면 추가한다. `_FakeClock`이 이미 있으면 재사용하고, 없으면 아래를 파일 상단(import 직후)에 추가한다:

```python
class _FakeClock:
    def __init__(self, now: float = 0.0):
        self._now = now

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_idle_offload.py::test_initial_state_can_start_unloaded -v
```

Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'initial_state'`

- [ ] **Step 3: Write minimal implementation**

`sidecar/app/stt/idle_offload.py`의 `__init__` 시그니처 마지막 파라미터 뒤에 추가:

```python
        clock: Callable[[], float] = time.monotonic,
        initial_state: ResidentState = ResidentState.GPU,
    ):
```

그리고 `self.state` 대입부를 바꾼다:

```python
        # 어댑터는 생성 시점엔 아직 load_model()을 안 거쳤을 수도 있지만, 기존 테스트들이
        # load_model() 없이 _model/_is_loaded를 직접 세팅하는 패턴을 쓰므로 기본값은 GPU로 둔다
        # (실질적 부작용 없음 — offload는 어차피 마지막 사용 후 TTL이 지나야 발동).
        # lazy load 모델(KURE 임베딩)은 첫 호출 전까지 메모리에 없으므로 UNLOADED를 주입한다.
        self.state: ResidentState = initial_state
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_idle_offload.py -q
```

Expected: 모두 PASS (기존 케이스 + 신규 2건)

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/stt/idle_offload.py sidecar/tests/test_idle_offload.py
git commit -m "feat(sidecar): IdleOffloadController에 initial_state 주입 지원"
```

---

### Task 2: KureEncoder에 유휴 오프로드 배선

**Files:**
- Modify: `sidecar/app/embeddings/encoder.py`
- Test: `sidecar/tests/test_embeddings_idle.py` (create)

**Interfaces:**
- Consumes: Task 1의 `IdleOffloadController(..., initial_state=ResidentState.UNLOADED)`
- Produces:
  - `KureEncoder.encode_async(texts: list[str]) -> list[list[float]]` (코루틴) — 컨트롤러 진입 후 executor에서 추론
  - `KureEncoder.maybe_offload(idle_unload_sec: float, idle_full_unload_sec: float) -> None` (코루틴) — 루프가 호출
  - `KureEncoder.resident_state -> str` (`"gpu"` | `"cpu"` | `"unloaded"`)
  - `KureEncoder.gpu_resident -> bool`
  - 기존 동기 `encode(texts)`는 시그니처 그대로 유지

- [ ] **Step 1: Write the failing test**

`sidecar/tests/test_embeddings_idle.py` 생성:

```python
"""KureEncoder 유휴 오프로드 동작 테스트.

실제 KURE 가중치·torch 없이, _load_raw를 가짜 모델로 몽키패치해 상태 전이만 검증한다.
"""
import pytest

from app.embeddings.encoder import KureEncoder
from app.stt.idle_offload import ResidentState


class _FakeConfig:
    hidden_size = 4


class _FakeModel:
    """nn.Module 대역 — .to()/eval() 호출 기록만 남긴다."""

    def __init__(self):
        self.config = _FakeConfig()
        self.device_history: list[str] = []

    def to(self, device):
        self.device_history.append(str(device))
        return self

    def eval(self):
        return self


class _FakeTokenizer:
    def __call__(self, texts, **kwargs):
        return {"input_ids": _FakeTensor(len(texts))}


class _FakeTensor:
    def __init__(self, n):
        self.n = n

    def to(self, device):
        return self


def _make_encoder(monkeypatch, device="cuda", loads=None):
    """_load_raw와 _encode_sync를 가짜로 대체한 인코더를 만든다."""
    enc = KureEncoder("fake/KURE", "kure-test", device)

    def _fake_load_raw(self):
        model = _FakeModel()
        if loads is not None:
            loads.append(model)
        return _FakeTokenizer(), model

    monkeypatch.setattr(KureEncoder, "_load_raw", _fake_load_raw)
    monkeypatch.setattr(
        KureEncoder, "_encode_sync", lambda self, texts: [[1.0, 0.0, 0.0, 0.0] for _ in texts]
    )
    return enc


def test_starts_unloaded(monkeypatch):
    """lazy load — 생성 직후에는 모델이 없고 상태가 unloaded여야 한다."""
    enc = _make_encoder(monkeypatch)
    assert enc.resident_state == "unloaded"
    assert enc.gpu_resident is False


@pytest.mark.asyncio
async def test_maybe_offload_before_first_load_is_noop(monkeypatch):
    """첫 encode 전에 오프로드 틱이 와도 크래시하지 않는다 (None.to() 방지)."""
    enc = _make_encoder(monkeypatch)
    await enc.maybe_offload(600, 3600)
    assert enc.resident_state == "unloaded"


@pytest.mark.asyncio
async def test_first_encode_loads_to_gpu(monkeypatch):
    loads = []
    enc = _make_encoder(monkeypatch, loads=loads)

    vecs = await enc.encode_async(["안녕"])

    assert vecs == [[1.0, 0.0, 0.0, 0.0]]
    assert enc.resident_state == "gpu"
    assert enc.gpu_resident is True
    assert len(loads) == 1


@pytest.mark.asyncio
async def test_two_stage_offload_transitions(monkeypatch):
    """gpu -> cpu -> unloaded 순서로 전이한다."""
    enc = _make_encoder(monkeypatch)
    await enc.encode_async(["안녕"])
    assert enc.resident_state == "gpu"

    # 1단계: 유휴 TTL 초과
    enc._idle.last_used -= 700
    await enc.maybe_offload(600, 3600)
    assert enc.resident_state == "cpu"
    assert enc._model is not None            # CPU에 가중치 유지

    # 2단계: 완전 해제 TTL 초과
    enc._idle.last_used -= 4000
    await enc.maybe_offload(600, 3600)
    assert enc.resident_state == "unloaded"
    assert enc._model is None                # RAM 반납
    assert enc._tok is None
    assert enc.dim == 4                      # dim은 유지 (빈 texts 조기 반환용)


@pytest.mark.asyncio
async def test_encode_after_full_unload_reloads(monkeypatch):
    """완전 해제 후 요청이 오면 디스크에서 재로드한다."""
    loads = []
    enc = _make_encoder(monkeypatch, loads=loads)
    await enc.encode_async(["안녕"])

    enc._idle.last_used -= 700
    await enc.maybe_offload(600, 3600)
    enc._idle.last_used -= 4000
    await enc.maybe_offload(600, 3600)
    assert enc.resident_state == "unloaded"

    vecs = await enc.encode_async(["다시"])
    assert vecs == [[1.0, 0.0, 0.0, 0.0]]
    assert enc.resident_state == "gpu"
    assert len(loads) == 2                   # 최초 1회 + 재로드 1회


@pytest.mark.asyncio
async def test_encode_from_cpu_returns_to_gpu(monkeypatch):
    loads = []
    enc = _make_encoder(monkeypatch, loads=loads)
    await enc.encode_async(["안녕"])

    enc._idle.last_used -= 700
    await enc.maybe_offload(600, 3600)
    assert enc.resident_state == "cpu"

    await enc.encode_async(["다시"])
    assert enc.resident_state == "gpu"
    assert len(loads) == 1                   # 재로드 없이 텐서만 이동


@pytest.mark.asyncio
async def test_cpu_device_offloads_straight_to_unloaded(monkeypatch):
    """CUDA가 아니면 gpu->cpu 전이가 무의미하므로 1단계에서 곧바로 완전 해제한다."""
    enc = _make_encoder(monkeypatch, device="cpu")
    await enc.encode_async(["안녕"])

    enc._idle.last_used -= 700
    await enc.maybe_offload(600, 3600)

    assert enc.resident_state == "unloaded"
    assert enc._model is None


@pytest.mark.asyncio
async def test_reload_failure_propagates_and_releases_lock(monkeypatch):
    """재로드가 실패해도 락이 풀려 다음 요청이 재시도할 수 있어야 한다 (영구 고장 방지)."""
    enc = _make_encoder(monkeypatch)

    def _boom(self):
        raise RuntimeError("모델 로드 실패")

    monkeypatch.setattr(KureEncoder, "_load_raw", _boom)

    with pytest.raises(RuntimeError, match="모델 로드 실패"):
        await enc.encode_async(["안녕"])

    assert enc.resident_state == "unloaded"   # 상태 전이 없음
    assert not enc._idle.lock.locked()        # 락 해제됨 — 다음 요청 진입 가능

    # 로드가 복구되면 정상 동작한다
    monkeypatch.setattr(
        KureEncoder, "_load_raw", lambda self: (_FakeTokenizer(), _FakeModel())
    )
    vecs = await enc.encode_async(["다시"])
    assert vecs == [[1.0, 0.0, 0.0, 0.0]]
    assert enc.resident_state == "gpu"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_embeddings_idle.py -q
```

Expected: FAIL — `AttributeError: 'KureEncoder' object has no attribute 'resident_state'`

- [ ] **Step 3: Write implementation**

`sidecar/app/embeddings/encoder.py`를 아래 내용으로 교체한다 (`pool_cls_normalize`와 `_resolve_device`는 그대로 유지):

```python
"""KURE-v1 임베딩 인코더 (folder-chat 의미검색용).

런타임=PyTorch + transformers.AutoModel. 풀링=CLS 토큰 + L2 정규화(BGE-M3/KURE 계열).
sentence-transformers 미사용(transformers<5 다운그레이드 방지).

유휴 오프로드: STT 어댑터와 같은 IdleOffloadController를 재사용해 유휴 TTL 초과 시
GPU -> CPU -> 완전 해제(RAM 반납) 2단계로 내린다. lazy load 모델이므로 컨트롤러를
UNLOADED 상태로 시작한다.
"""
from __future__ import annotations

import asyncio
import logging

from app.stt.idle_offload import IdleOffloadController, ResidentState

logger = logging.getLogger(__name__)


def pool_cls_normalize(last_hidden_state):
    """CLS 토큰(0번) 추출 후 L2 정규화. (batch, seq, hidden) -> (batch, hidden).

    torch는 함수 내부에서 lazy import — 모듈 import만으로 torch가 로드되지 않게(idle 풋프린트).
    """
    import torch.nn.functional as F
    cls = last_hidden_state[:, 0]
    return F.normalize(cls, p=2, dim=1)


def _resolve_device(device: str) -> str:
    if device and device != "auto":
        return device
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


class KureEncoder:
    """KURE-v1 임베딩 인코더. 첫 encode 호출 시 모델·torch를 lazy load한다."""

    def __init__(self, model_name: str, version: str, device: str = "auto"):
        self.model_name = model_name
        self.model_version = version
        self._requested_device = device
        # 디바이스는 오프로드 콜백 구성을 결정하므로 생성 시점에 확정한다.
        # _resolve_device는 torch.cuda.is_available()만 호출하고 모델을 로드하지 않는다.
        self.device: str = _resolve_device(device)
        self.dim: int | None = None
        self._tok = None
        self._model = None

        is_cuda = str(self.device).startswith("cuda")
        if is_cuda:
            # GPU: 1단계 CPU 이동(가중치 유지) -> 2단계 완전 해제
            self._idle = IdleOffloadController(
                name=f"embed({model_name})",
                stage1_offload=self._offload_to_cpu,
                stage1_target=ResidentState.CPU,
                reload_from_cpu=self._reload_from_cpu,
                stage2_offload=self._offload_full,
                reload_from_unloaded=self._reload_full,
                initial_state=ResidentState.UNLOADED,
            )
        else:
            # CPU 상주 모델은 gpu->cpu 전이가 무의미 — 1단계에서 곧바로 완전 해제
            self._idle = IdleOffloadController(
                name=f"embed({model_name})",
                stage1_offload=self._offload_full,
                stage1_target=ResidentState.UNLOADED,
                reload_from_unloaded=self._reload_full,
                initial_state=ResidentState.UNLOADED,
            )

    def _load_raw(self):
        """(tokenizer, model) 반환. transformers AutoModel/AutoTokenizer 사용."""
        from transformers import AutoModel, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(self.model_name)
        model = AutoModel.from_pretrained(self.model_name)
        return tok, model

    def load(self) -> None:
        if self._model is not None:
            return
        logger.info("[embed] KURE 로드 시작 model=%s device=%s", self.model_name, self.device)
        tok, model = self._load_raw()
        self._tok = tok
        self._model = model.to(self.device).eval()
        self.dim = int(self._model.config.hidden_size)
        self._idle.mark_loaded()
        logger.info("[embed] KURE 로드 완료 dim=%s", self.dim)

    # ── 유휴 오프로드 콜백 ────────────────────────────────────────────
    async def _offload_to_cpu(self) -> None:
        """1단계: GPU -> CPU (가중치 유지)."""
        loop = asyncio.get_running_loop()

        def _off():
            import torch
            self._model.to("cpu")
            torch.cuda.empty_cache()

        await loop.run_in_executor(None, _off)

    async def _reload_from_cpu(self) -> None:
        """1단계 복귀: CPU -> GPU (디스크 접근 없이 빠름)."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._model.to(self.device))

    async def _offload_full(self) -> None:
        """2단계: 모델·토크나이저 완전 해제 (RAM 반납).

        dim과 device는 유지한다 — 같은 모델을 재로드하면 동일한 값이고,
        언로드 상태에서도 /embed의 빈 texts 조기 반환이 dim을 참조한다.
        """
        loop = asyncio.get_running_loop()

        def _unload():
            import gc
            self._model = None
            self._tok = None
            gc.collect()

        await loop.run_in_executor(None, _unload)

    async def _reload_full(self) -> None:
        """2단계 복귀: 디스크/HF 캐시에서 재로드 (느림, 수 초)."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.load)

    # ── 상태 조회 / 루프 진입점 ──────────────────────────────────────
    @property
    def gpu_resident(self) -> bool:
        return self._idle.gpu_resident

    @property
    def resident_state(self) -> str:
        return self._idle.state.value

    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        await self._idle.maybe_offload(idle_unload_sec, idle_full_unload_sec)

    # ── 추론 ─────────────────────────────────────────────────────────
    def _encode_sync(self, texts: list[str]) -> list[list[float]]:
        """실제 추론. 호출 시점에 모델이 로드돼 있다고 가정한다."""
        import torch
        enc = self._tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        enc = {k: v.to(self.device) for k, v in enc.items()}
        with torch.no_grad():
            out = self._model(**enc)
        vecs = pool_cls_normalize(out.last_hidden_state)
        if self.dim is None:
            self.dim = int(vecs.shape[1])
        return vecs.cpu().tolist()

    def encode(self, texts: list[str]) -> list[list[float]]:
        """동기 진입점 (테스트·직접 호출 호환). 유휴 상태 추적을 하지 않는다."""
        self.load()
        return self._encode_sync(texts)

    async def encode_async(self, texts: list[str]) -> list[list[float]]:
        """async 진입점 — 필요 시 GPU 복귀, 동시 호출 직렬화, last_used 갱신.

        추론은 executor에 넘겨 이벤트 루프를 막지 않는다 (백필 잡이 도는 동안
        실시간 전사 요청이 대기하던 문제 해소).
        """
        async with self._idle:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, self._encode_sync, texts)
```

`_reload_full`이 `self.load()`를 호출하고 `load()`가 `mark_loaded()`를 부르지만, 컨트롤러의 `_do_reload`가 그 뒤 `state = GPU`를 다시 대입하므로 결과는 같다. `mark_loaded()`는 최초 로드 경로(동기 `encode()`)를 위해 필요하다.

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_embeddings_idle.py tests/test_embeddings_pool.py -q
```

Expected: PASS (신규 8건 + 기존 pool 테스트)

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/embeddings/encoder.py sidecar/tests/test_embeddings_idle.py
git commit -m "feat(sidecar): KURE 임베딩 유휴 2단계 오프로드 — GPU·RAM 반납"
```

---

### Task 3: /embed 라우터를 encode_async로 전환

**Files:**
- Modify: `sidecar/app/routers/embeddings.py:13-22`
- Modify: `sidecar/app/main.py` (`app.state.embed_lock` 제거)
- Test: `sidecar/tests/test_embeddings_router.py:21-49`

**Interfaces:**
- Consumes: Task 2의 `KureEncoder.encode_async(texts)`
- Produces: 없음 (엔드포인트 계약 불변 — 응답 스키마 동일)

- [ ] **Step 1: Update the test to the new contract**

`sidecar/tests/test_embeddings_router.py`의 `_StubEncoder`를 async 진입점으로 바꾸고, 빈 요청이 모델을 깨우지 않는지 검증을 추가한다. 21-49행을 아래로 교체:

```python
class _StubEncoder:
    model_version = "kure-v1"
    dim = 4

    def __init__(self):
        self.calls = 0

    async def encode_async(self, texts):
        self.calls += 1
        return [[1.0, 0.0, 0.0, 0.0] for _ in texts]


@pytest.fixture()
def client():
    from app.main import app
    with TestClient(app) as c:
        c.app.state.embedder = _StubEncoder()  # 실제 KURE 로드 우회
        yield c


def test_embed_returns_vectors(client):
    r = client.post("/embed", json={"texts": ["회의 예산", "런치 메뉴"]})
    assert r.status_code == 200
    data = r.json()
    assert data["model"] == "kure-v1"
    assert data["dim"] == 4
    assert len(data["embeddings"]) == 2
    assert data["embeddings"][0] == [1.0, 0.0, 0.0, 0.0]


def test_embed_empty_texts(client):
    r = client.post("/embed", json={"texts": []})
    assert r.status_code == 200
    assert r.json()["embeddings"] == []


def test_embed_empty_texts_does_not_wake_model(client):
    """빈 요청은 인코더를 건드리지 않는다 — 언로드 상태를 유지해야 한다."""
    client.post("/embed", json={"texts": []})
    assert client.app.state.embedder.calls == 0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_embeddings_router.py -q
```

Expected: FAIL — 라우터가 아직 동기 `encode`를 호출하므로 `AttributeError: '_StubEncoder' object has no attribute 'encode'`

- [ ] **Step 3: Write implementation**

`sidecar/app/routers/embeddings.py`의 핸들러 본문을 교체:

```python
@router.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest, http_request: Request) -> EmbedResponse:
    encoder = http_request.app.state.embedder
    if not request.texts:
        # 모델을 깨우지 않는다 — 유휴 언로드 상태를 유지한다.
        return EmbedResponse(embeddings=[], model=encoder.model_version, dim=encoder.dim or 0)
    # 동시 호출 직렬화·GPU 복귀·유휴 시각 갱신은 인코더의 IdleOffloadController가 담당한다.
    vectors = await encoder.encode_async(request.texts)
    return EmbedResponse(embeddings=vectors, model=encoder.model_version, dim=encoder.dim or len(vectors[0]))
```

`sidecar/app/main.py`의 lifespan에서 아래 한 줄을 삭제한다 (컨트롤러 락과 중복):

```python
    app.state.embed_lock = asyncio.Lock()
```

`embed_lock`을 참조하는 다른 코드가 없는지 확인한다:

```bash
grep -rn "embed_lock" app/ tests/
```

결과가 비어 있어야 한다.

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_embeddings_router.py tests/test_embeddings_idle.py -q
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/routers/embeddings.py sidecar/app/main.py sidecar/tests/test_embeddings_router.py
git commit -m "refactor(sidecar): /embed를 encode_async로 전환 — 이중 락 제거·루프 블로킹 해소"
```

---

### Task 4: 유휴 점검 루프 다중 대상화

> **구현 갱신(2026-08-10)**: 아래 Step들은 최초 계획대로 `app.state.idle_managed` 고정
> 리스트를 lifespan에서 한 번 등록하는 안을 그대로 남긴 기록이다. 실제 구현은 이
> 안 대신 `_collect_idle_targets(app)` 헬퍼로 **매 틱 동적 수집**하는 방식을 썼다
> (`sidecar/app/main.py` 참조, 최종 코드는 고정 리스트를 만들지 않는다). 이유:
> `app/routers/health.py`의 STT 엔진 런타임 교체(`PUT /settings/stt-engine`)가
> `app.state.stt_adapter`를 새 어댑터로 교체하는데, 고정 리스트는 옛 참조를 들고
> 있어 교체 후 새 어댑터가 영영 점검 대상에서 빠지는 갭이 있었기 때문이다. 회귀
> 테스트 `test_loop_picks_up_stt_adapter_swapped_at_runtime`이 이 갭을 검증한다.
> 아래 Step 3의 구현 스니펫과 `app.state.idle_managed` 등록/종료 정리 부분은
> 고정 리스트 안에 해당하므로 실제 코드와 다르다 — 최종 동작은 위 갱신 설명과
> `sidecar/app/main.py`를 기준으로 삼는다.

**Files:**
- Modify: `sidecar/app/main.py:23-47` (`_idle_offload_loop`), lifespan
- Test: `sidecar/tests/test_main_idle_offload.py`

**Interfaces:**
- Consumes: Task 2의 `KureEncoder.maybe_offload(...)`
- Produces (최초 계획, 이후 동적 수집 방식으로 대체됨): `app.state.idle_managed: list` — `maybe_offload(idle_unload_sec, idle_full_unload_sec)` 코루틴을 가진 객체들의 목록. 루프가 이 목록을 순회한다.

- [ ] **Step 1: Update and extend the tests**

`sidecar/tests/test_main_idle_offload.py`의 `_FakeApp`을 목록 기반으로 바꾸고 케이스를 추가한다. 12-28행을 아래로 교체:

```python
class _FakeState:
    pass


class _FakeApp:
    def __init__(self, *managed):
        self.state = _FakeState()
        self.state.idle_managed = [m for m in managed if m is not None]


class _CountingAdapter:
    def __init__(self):
        self.calls: list[tuple[float, float]] = []

    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        self.calls.append((idle_unload_sec, idle_full_unload_sec))
```

`test_loop_survives_none_adapter`는 목록이 비는 경우로 바꾼다:

```python
@pytest.mark.asyncio
async def test_loop_survives_empty_managed_list(monkeypatch):
    """엔진 교체 중 등록 대상이 비어도 틱이 예외 없이 지나간다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    fake_app = _FakeApp()

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    # 예외 없이 여기까지 도달하면 성공
```

파일 끝에 다중 대상·예외 격리 케이스를 추가한다:

```python
@pytest.mark.asyncio
async def test_loop_checks_every_managed_target(monkeypatch):
    """STT 어댑터와 임베딩 인코더가 모두 점검된다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    stt = _CountingAdapter()
    embedder = _CountingAdapter()
    fake_app = _FakeApp(stt, embedder)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.09)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(stt.calls) >= 2
    assert len(embedder.calls) >= 2
    assert embedder.calls[0] == (600, 3600)


@pytest.mark.asyncio
async def test_one_target_failure_does_not_block_others(monkeypatch):
    """한 대상이 터져도 같은 틱의 다른 대상은 점검된다."""
    from app.config import settings
    from app.main import _idle_offload_loop

    monkeypatch.setattr(settings, "STT_IDLE_UNLOAD_SEC", 600)
    monkeypatch.setattr(settings, "STT_IDLE_FULL_UNLOAD_SEC", 3600)

    class _Exploding:
        async def maybe_offload(self, *_args):
            raise RuntimeError("boom")

    healthy = _CountingAdapter()
    fake_app = _FakeApp(_Exploding(), healthy)

    task = asyncio.create_task(_idle_offload_loop(fake_app, interval_sec=0.02))
    await asyncio.sleep(0.07)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(healthy.calls) >= 2
```

기존 `test_loop_survives_maybe_offload_exception`의 `_FakeApp(adapter)` 호출은 새 시그니처(가변 인자)와 그대로 호환되므로 수정하지 않는다.

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/python -m pytest tests/test_main_idle_offload.py -q
```

Expected: FAIL — 루프가 아직 `app.state.stt_adapter`를 읽으므로 `_CountingAdapter.calls`가 비어 assert 실패

- [ ] **Step 3: Write implementation**

`sidecar/app/main.py`의 `_idle_offload_loop` 본문 중 `while True:` 블록을 교체:

```python
    while True:
        await asyncio.sleep(interval_sec)
        for target in getattr(app.state, "idle_managed", []):
            if target is None:
                continue
            try:
                await target.maybe_offload(idle_unload_sec, idle_full_unload_sec)
            except Exception:
                logger.exception(
                    "[idle-offload] %s 오프로드 점검 실패 (다음 주기에 재시도)",
                    type(target).__name__,
                )
```

docstring도 갱신한다:

```python
async def _idle_offload_loop(app: FastAPI, interval_sec: float = _IDLE_OFFLOAD_INTERVAL_SEC) -> None:
    """주기적으로 유휴 관리 대상(STT 어댑터·임베딩 인코더)의 GPU 오프로드를 점검한다.

    대상별로 예외를 격리해 한 대상의 실패가 다른 대상 점검을 막지 않게 한다.
    """
```

lifespan에서 목록을 등록한다. `app.state.embedder = KureEncoder(...)` 다음 줄에 추가하고, `idle_offload_task` 생성보다 앞에 둔다:

```python
    # 유휴 오프로드 점검 대상. GPU 상주 모델이 늘면 여기에 추가한다.
    app.state.idle_managed = [app.state.stt_adapter, app.state.embedder]
```

종료 정리부에서 `app.state.stt_adapter = None` 옆에 목록도 비운다:

```python
    app.state.stt_adapter = None
    app.state.idle_managed = []
    gc.collect()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_main_idle_offload.py -q
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/main.py sidecar/tests/test_main_idle_offload.py
git commit -m "feat(sidecar): 유휴 점검 루프 다중 대상화 — STT·임베딩 동시 관리"
```

---

### Task 5: /health에 embed_state 노출

인코더의 상주 상태를 외부에서 확인할 방법이 없으면 이번 변경의 동작을 배포 후 검증할 수 없다.

**Files:**
- Modify: `sidecar/app/schemas.py:9-15`
- Modify: `sidecar/app/routers/health.py:32-51`, `:85-120`
- Test: `sidecar/tests/test_health_embed_state.py` (create)

**Interfaces:**
- Consumes: Task 2의 `KureEncoder.resident_state`
- Produces: `HealthResponse.embed_state: str` (`"gpu"` | `"cpu"` | `"unloaded"`, 기본 `"unloaded"`)

- [ ] **Step 1: Write the failing test**

`sidecar/tests/test_health_embed_state.py` 생성:

```python
"""GET /health의 embed_state 필드 테스트."""
import pytest
from fastapi.testclient import TestClient


class _StubEncoder:
    model_version = "kure-v1"
    dim = 4

    def __init__(self, state="unloaded"):
        self.resident_state = state


@pytest.fixture()
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_health_reports_unloaded_embedder(client):
    client.app.state.embedder = _StubEncoder("unloaded")
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["embed_state"] == "unloaded"


def test_health_reports_gpu_embedder(client):
    client.app.state.embedder = _StubEncoder("gpu")
    assert client.get("/health").json()["embed_state"] == "gpu"


def test_health_reports_cpu_embedder(client):
    client.app.state.embedder = _StubEncoder("cpu")
    assert client.get("/health").json()["embed_state"] == "cpu"


def test_health_survives_missing_embedder(client):
    client.app.state.embedder = None
    assert client.get("/health").json()["embed_state"] == "unloaded"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/test_health_embed_state.py -q
```

Expected: FAIL — `KeyError: 'embed_state'`

- [ ] **Step 3: Write implementation**

`sidecar/app/schemas.py`의 `HealthResponse`에 필드를 추가:

```python
class HealthResponse(BaseModel):
    """GET /health 응답 스키마."""
    status: str
    stt_engine: str
    model_loaded: bool
    gpu_resident: bool = True  # STT 모델이 현재 GPU에 상주 중인지 (유휴 오프로드 상태 반영)
    model_state: str = "gpu"  # "gpu" | "cpu" | "unloaded"
    embed_state: str = "unloaded"  # KURE 임베딩 인코더 상주 상태 (lazy load라 기본은 unloaded)
```

`sidecar/app/routers/health.py`에 헬퍼를 추가한다 (`router = APIRouter()` 아래):

```python
def _embed_state(request: Request) -> str:
    """임베딩 인코더의 상주 상태. 미생성·미로드면 "unloaded"."""
    encoder = getattr(request.app.state, "embedder", None)
    return getattr(encoder, "resident_state", "unloaded") if encoder is not None else "unloaded"
```

`health()` 반환문에 필드를 추가:

```python
    return HealthResponse(
        status="ok",
        stt_engine=resolved_engine,
        model_loaded=adapter.is_loaded if adapter is not None else False,
        gpu_resident=adapter.gpu_resident if adapter is not None else False,
        model_state=adapter.resident_state if adapter is not None else "unloaded",
        embed_state=_embed_state(request),
    )
```

STT 엔진 교체 경로(같은 파일의 다른 `HealthResponse(...)` 생성부 2곳, 대략 92행·116행)에도 동일하게 `embed_state=_embed_state(request)`를 추가한다. 해당 핸들러의 `Request` 인자 이름이 `request`가 아니면 그 이름을 쓴다. 먼저 확인:

```bash
grep -n "HealthResponse(" app/routers/health.py
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/python -m pytest tests/test_health_embed_state.py -q
```

Expected: PASS (4건)

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/schemas.py sidecar/app/routers/health.py sidecar/tests/test_health_embed_state.py
git commit -m "feat(sidecar): /health에 embed_state 노출 — 임베딩 상주 상태 관측"
```

---

### Task 6: 전체 회귀 확인

**Files:**
- Test: `sidecar/tests/` 전체

- [ ] **Step 1: Run the idle/embed suites**

```bash
.venv/bin/python -m pytest tests/test_idle_offload.py tests/test_main_idle_offload.py \
  tests/test_qwen3_transformers_adapter_idle.py tests/test_faster_whisper_adapter_idle.py \
  tests/test_embeddings_router.py tests/test_embeddings_pool.py \
  tests/test_embeddings_idle.py tests/test_health_embed_state.py -q
```

Expected: 전부 PASS. 베이스라인 51건 + 신규 약 16건.

- [ ] **Step 2: Run the full sidecar suite**

```bash
.venv/bin/python -m pytest tests/ -q 2>&1 | tail -20
```

Expected: 실패 0건. 실패가 있으면 이번 변경과 무관한 기존 실패인지 `git stash`로 확인한다.

- [ ] **Step 3: Verify no leftover references**

```bash
grep -rn "embed_lock" app/ tests/ ; echo "---" ; grep -rn "state.stt_adapter" app/main.py
```

Expected: `embed_lock`은 결과 없음. `app/main.py`의 `state.stt_adapter`는 lifespan 대입·목록 등록·종료 정리에만 남고 루프에는 없어야 한다.

- [ ] **Step 4: Commit any fixes**

수정이 있었다면:

```bash
git add -A
git commit -m "fix(sidecar): 유휴 언로드 회귀 수정"
```

---

## 배포 후 실측 검증

머지·재기동 후 아래를 순서대로 확인한다. 재기동은 사용자 승인이 필요하다.

1. 기동 직후: `curl -s localhost:13324/health | jq .embed_state` → `"unloaded"`
2. `curl -s -X POST localhost:13324/embed -H 'Content-Type: application/json' -d '{"texts":["테스트"]}' > /dev/null` 후 `embed_state` → `"gpu"`
3. 10분 유휴 후: `embed_state` → `"cpu"`, `nvidia-smi --query-gpu=memory.used --format=csv`로 GPU 점유 감소 확인
4. 1시간 유휴 후: `embed_state` → `"unloaded"`, `ps -o rss= -p $(systemctl show ddobak-stt -p ExecMainPID --value)`로 RSS 감소 확인
5. 이후 `/embed` 재호출이 200을 반환 (재로드 경로 정상)
