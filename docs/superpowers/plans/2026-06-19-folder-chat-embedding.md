# 폴더/프로젝트 챗 의미검색(임베딩) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더/프로젝트 챗 retrieval에 KURE-v1 임베딩 의미검색을 추가하고 기존 FTS5와 RRF로 하이브리드 융합한다.

**Architecture:** sidecar에 stateless `POST /embed`(KURE-v1, torch, CLS pool+L2norm) 추가. Rails는 전사 행 단위 임베딩을 plain BLOB 테이블(`transcript_embeddings`)에 저장(after_commit 비동기 잡, content dirty-check)하고, 검색은 `accessible_by` meeting_id로 필터한 후보를 numo-narray로 exact cosine(브루트포스) → FTS 랭크와 RRF 융합. 검색은 `TranscriptVectorSearch`(VectorIndex 추상화) 뒤에 두어 추후 pgvector 교체 가능.

**Tech Stack:** Rails 8.1 / RSpec+FactoryBot / SQLite + numo-narray / FastAPI sidecar(Python 3.11, torch 2.11, transformers 5.3) / KURE-v1.

## Global Constraints

- 임베딩 모델 = `nlpai-lab/KURE-v1`, dim **1024**, 풀링 **CLS + L2 normalize**(실측 확정). `MODEL_VERSION = "kure-v1"`.
- 런타임 = PyTorch + `transformers.AutoModel`(sentence-transformers 사용 금지 — transformers<5 다운그레이드 방지). device 자동감지(`cuda`>`cpu`, 기본 CPU).
- 저장 = fp32 little-endian BLOB(`Array#pack("e*")` / `String#unpack("e*")`). 차원 가변 대비 `dim` 컬럼 보관.
- **인가(하드 요구):** FTS·벡터 두 경로 모두 동일한 `meeting_ids = scope ∩ Meeting.accessible_by(user)`로 필터. 벡터 후보 로드 SQL에 `WHERE meeting_id IN (...)` 필수. 누락 시 privilege escalation.
- 재임베딩만 영향 — `transcripts`/`transcripts_fts`는 절대 건드리지 않음.
- 벡터 경로 실패(sidecar 다운/타임아웃)는 **챗을 막지 않음** — FTS-only로 graceful fallback.
- content 변경시에만 재임베딩(dirty-check). 임베딩은 비싸므로 FTS처럼 blind upsert 금지.
- 커밋은 각 태스크 끝에서. 푸시/머지는 사용자 명시 요청 전까지 금지.
- 백엔드 테스트=RSpec(`backend/spec/`), 잡은 `perform_now` 동기 실행, 외부 HTTP는 `allow(SidecarClient).to receive(:new)`로 스텁(WebMock 미사용). sidecar 테스트=pytest, `TestClient(app)` + `app.state` 주입.

**Phase 0 (PoC 게이트) — ✅ 2026-06-19 전부 통과** (`/tmp/kure_poc.py`): torch 2.11.0×transformers 5.3.0×mlx 공존, KURE 로드(CLS dim1024 self-cos 1.0), 의미 sanity(0.856 vs 0.38), numo-narray 0.9.2.1 빌드+matmul, BLOB `e*` roundtrip. 설계 수정 없음. spec: `docs/superpowers/specs/2026-06-19-folder-chat-embedding-design.md`.

---

## File Structure

**Sidecar (Python):**
- Create `sidecar/app/embeddings/__init__.py`
- Create `sidecar/app/embeddings/encoder.py` — `KureEncoder`(lazy load, encode) + `pool_cls_normalize` 순수함수
- Create `sidecar/app/routers/embeddings.py` — `POST /embed`
- Modify `sidecar/app/schemas.py` — `EmbedRequest`, `EmbedResponse`
- Modify `sidecar/app/config.py` — `EMBED_MODEL`, `EMBED_MODEL_VERSION`, `EMBED_DEVICE` 설정
- Modify `sidecar/app/main.py` — lifespan에 `app.state.embedder`/`embed_lock`, 라우터 등록
- Modify `sidecar/pyproject.toml` — torch 정식 선언
- Create tests: `sidecar/tests/test_embeddings_pool.py`, `sidecar/tests/test_embeddings_router.py`

**Backend (Rails):**
- Modify `backend/Gemfile` — `gem "numo-narray"`
- Create `backend/db/migrate/20260619000001_create_transcript_embeddings.rb`
- Create `backend/app/models/transcript_embedding.rb`
- Create `backend/app/models/concerns/embeddable.rb`
- Modify `backend/app/models/transcript.rb` — `include Embeddable`
- Modify `backend/app/services/sidecar_client.rb` — `#embed`
- Create `backend/app/jobs/embed_transcript_job.rb`
- Create `backend/app/jobs/embed_backfill_job.rb`
- Create `backend/lib/tasks/embeddings.rake`
- Create `backend/app/services/transcript_vector_search.rb`
- Modify `backend/app/services/folder_chat_context.rb` — 하이브리드 RRF + `query_text`
- Modify `backend/app/jobs/folder_chat_job.rb` — `query_text` 전달
- Create tests: `backend/spec/models/transcript_embedding_spec.rb`, `backend/spec/models/transcript_embeddable_spec.rb`, `backend/spec/services/sidecar_client_embed_spec.rb`, `backend/spec/jobs/embed_transcript_job_spec.rb`, `backend/spec/jobs/embed_backfill_job_spec.rb`, `backend/spec/services/transcript_vector_search_spec.rb`, `backend/spec/services/folder_chat_context_hybrid_spec.rb`

---

## Phase 1 — Sidecar 임베딩 서비스

### Task 1: 임베딩 설정 + 스키마

**Files:**
- Modify: `sidecar/app/config.py`
- Modify: `sidecar/app/schemas.py`
- Test: `sidecar/tests/test_embeddings_router.py` (스키마 import 부분)

**Interfaces:**
- Produces: `Settings.EMBED_MODEL: str`, `Settings.EMBED_MODEL_VERSION: str`, `Settings.EMBED_DEVICE: str`; `EmbedRequest(texts: list[str])`, `EmbedResponse(embeddings: list[list[float]], model: str, dim: int)`.

- [ ] **Step 1: Write the failing test** — `sidecar/tests/test_embeddings_router.py`

```python
"""Tests for POST /embed (folder-chat embedding)."""
from app.schemas import EmbedRequest, EmbedResponse


def test_embed_request_schema():
    req = EmbedRequest(texts=["안녕", "회의"])
    assert req.texts == ["안녕", "회의"]


def test_embed_response_schema():
    resp = EmbedResponse(embeddings=[[0.1, 0.2]], model="kure-v1", dim=2)
    assert resp.dim == 2
    assert resp.model == "kure-v1"
    assert resp.embeddings[0] == [0.1, 0.2]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_router.py -q`
Expected: FAIL — `ImportError: cannot import name 'EmbedRequest'`

- [ ] **Step 3: Add schemas** — append to `sidecar/app/schemas.py`

```python
class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int
```

- [ ] **Step 4: Add settings** — in `sidecar/app/config.py`, add fields to the `Settings` class (alongside existing fields like `STT_ENGINE`/`LLM_MODEL`):

```python
    EMBED_MODEL: str = "nlpai-lab/KURE-v1"
    EMBED_MODEL_VERSION: str = "kure-v1"
    EMBED_DEVICE: str = "auto"  # auto -> cuda if available else cpu
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_router.py -q`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add sidecar/app/config.py sidecar/app/schemas.py sidecar/tests/test_embeddings_router.py
git commit -m "feat(embed): sidecar 임베딩 설정·스키마 추가"
```

---

### Task 2: CLS 풀링 + L2 정규화 순수함수

**Files:**
- Create: `sidecar/app/embeddings/__init__.py` (빈 파일)
- Create: `sidecar/app/embeddings/encoder.py` (함수만 먼저)
- Test: `sidecar/tests/test_embeddings_pool.py`

**Interfaces:**
- Produces: `pool_cls_normalize(last_hidden_state: torch.Tensor) -> torch.Tensor` — `[:, 0]` CLS 토큰 추출 후 L2 정규화. 입력 `(batch, seq, hidden)`, 출력 `(batch, hidden)` 각 행 norm=1.

- [ ] **Step 1: Write the failing test** — `sidecar/tests/test_embeddings_pool.py`

```python
import torch
from app.embeddings.encoder import pool_cls_normalize


def test_pool_takes_cls_token_and_normalizes():
    # batch=1, seq=3, hidden=4 — CLS(0번 토큰)만 사용
    h = torch.tensor([[[3.0, 4.0, 0.0, 0.0],   # CLS → norm 5
                       [9.0, 9.0, 9.0, 9.0],    # 무시돼야 함
                       [1.0, 0.0, 0.0, 0.0]]])
    out = pool_cls_normalize(h)
    assert out.shape == (1, 4)
    # L2 정규화: [3,4,0,0]/5 = [0.6, 0.8, 0, 0]
    assert torch.allclose(out[0], torch.tensor([0.6, 0.8, 0.0, 0.0]), atol=1e-5)
    assert torch.allclose(out.norm(dim=1), torch.ones(1), atol=1e-5)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_pool.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.embeddings'`

- [ ] **Step 3: Create module + function**

`sidecar/app/embeddings/__init__.py`: 빈 파일.

`sidecar/app/embeddings/encoder.py`:

```python
"""KURE-v1 임베딩 인코더 (folder-chat 의미검색용).

런타임=PyTorch + transformers.AutoModel. 풀링=CLS 토큰 + L2 정규화(BGE-M3/KURE 계열).
sentence-transformers 미사용(transformers<5 다운그레이드 방지).
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def pool_cls_normalize(last_hidden_state):
    """CLS 토큰(0번) 추출 후 L2 정규화. (batch, seq, hidden) -> (batch, hidden).

    torch는 함수 내부에서 lazy import — 모듈 import만으로 torch가 로드되지 않게(idle 풋프린트).
    """
    import torch.nn.functional as F
    cls = last_hidden_state[:, 0]
    return F.normalize(cls, p=2, dim=1)
```

> torch를 모듈 최상단이 아닌 함수/메서드 내부에서 import한다. lifespan이 `KureEncoder`를 import해도 `/embed` 첫 호출 전엔 torch가 로드되지 않는다(spec의 lazy 의도 충족).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_pool.py -q`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add sidecar/app/embeddings/ sidecar/tests/test_embeddings_pool.py
git commit -m "feat(embed): CLS 풀링+L2정규화 순수함수"
```

---

### Task 3: KureEncoder (lazy load + encode)

**Files:**
- Modify: `sidecar/app/embeddings/encoder.py`
- Test: `sidecar/tests/test_embeddings_pool.py` (encode 단위 — fake 모델 주입)

**Interfaces:**
- Consumes: `pool_cls_normalize` (Task 2).
- Produces: `KureEncoder(model_name: str, version: str, device: str = "auto")` with `.encode(texts: list[str]) -> list[list[float]]`(각 1024-dim, L2정규화), `.model_version: str`, `.dim: int|None`(첫 encode 후 설정), `.load()`(idempotent). encode 첫 호출 시 모델 lazy load.

- [ ] **Step 1: Write the failing test** — append to `sidecar/tests/test_embeddings_pool.py`

```python
import types
from app.embeddings.encoder import KureEncoder


class _FakeTok:
    def __call__(self, texts, padding=True, truncation=True, max_length=512, return_tensors="pt"):
        n = len(texts)
        return {"input_ids": torch.ones(n, 3, dtype=torch.long),
                "attention_mask": torch.ones(n, 3, dtype=torch.long)}
    def to(self, *_a, **_k):  # enc.to(device) 호환
        return self


class _FakeModelOut:
    def __init__(self, h): self.last_hidden_state = h


class _FakeModel:
    config = types.SimpleNamespace(hidden_size=4)
    def to(self, *_a, **_k): return self
    def eval(self): return self
    def __call__(self, **enc):
        n = enc["attention_mask"].shape[0]
        # 각 샘플 CLS = [3,4,0,0] → 정규화 [0.6,0.8,0,0]
        h = torch.zeros(n, 3, 4); h[:, 0, 0] = 3.0; h[:, 0, 1] = 4.0
        return _FakeModelOut(h)


def test_encode_returns_normalized_vectors(monkeypatch):
    enc = KureEncoder(model_name="x", version="kure-v1", device="cpu")
    monkeypatch.setattr(enc, "_load_raw", lambda: (_FakeTok(), _FakeModel()))
    out = enc.encode(["a", "b"])
    assert len(out) == 2
    assert len(out[0]) == 4
    assert abs((sum(v * v for v in out[0])) ** 0.5 - 1.0) < 1e-5
    assert enc.dim == 4
    assert enc.model_version == "kure-v1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_pool.py::test_encode_returns_normalized_vectors -q`
Expected: FAIL — `AttributeError: ... KureEncoder` / cannot import

- [ ] **Step 3: Implement KureEncoder** — append to `sidecar/app/embeddings/encoder.py`

```python
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
        self.device: str | None = None     # load() 시 확정
        self.dim: int | None = None
        self._tok = None
        self._model = None

    def _load_raw(self):
        """(tokenizer, model) 반환. transformers AutoModel/AutoTokenizer 사용."""
        from transformers import AutoModel, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(self.model_name)
        model = AutoModel.from_pretrained(self.model_name)
        return tok, model

    def load(self) -> None:
        if self._model is not None:
            return
        self.device = _resolve_device(self._requested_device)
        logger.info("[embed] KURE 로드 시작 model=%s device=%s", self.model_name, self.device)
        tok, model = self._load_raw()
        self._tok = tok
        self._model = model.to(self.device).eval()
        self.dim = int(self._model.config.hidden_size)
        logger.info("[embed] KURE 로드 완료 dim=%s", self.dim)

    def encode(self, texts: list[str]) -> list[list[float]]:
        import torch
        self.load()
        enc = self._tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        enc = {k: v.to(self.device) for k, v in enc.items()} if hasattr(enc, "items") else enc.to(self.device)
        with torch.no_grad():
            out = self._model(**enc)
        vecs = pool_cls_normalize(out.last_hidden_state)
        if self.dim is None:
            self.dim = int(vecs.shape[1])
        return vecs.cpu().tolist()
```

> torch는 `encode`/`_resolve_device` 내부에서 import(lazy). `@torch.no_grad()` 데코레이터 대신 `with torch.no_grad():` — 클래스 정의 시 torch 불필요. 테스트의 `_FakeTok.__call__`은 dict 반환 → `enc.items()` 분기로 각 텐서에 `.to(device)` 적용. 실제 transformers `BatchEncoding`도 `.items()` 지원.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_pool.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Real-model smoke (게이트 재확인, 무거움 — 1회)**

Run: `cd sidecar && .venv/bin/python -c "from app.embeddings.encoder import KureEncoder; e=KureEncoder('nlpai-lab/KURE-v1','kure-v1','cpu'); v=e.encode(['신제품 출시 연기','제품 런칭 미루기','점심 김치찌개']); import numpy as np; a=np.array(v); print('dim',a.shape[1]); print('sim_sim', float(a[0]@a[1]),'sim_un', float(a[0]@a[2]))"`
Expected: `dim 1024`, sim_sim(≈0.85) > sim_un(≈0.38). (모델은 HF 캐시에 이미 있음.)

- [ ] **Step 6: Commit**

```bash
git add sidecar/app/embeddings/encoder.py sidecar/tests/test_embeddings_pool.py
git commit -m "feat(embed): KureEncoder lazy load+encode"
```

---

### Task 4: POST /embed 라우터 + lifespan 등록

**Files:**
- Create: `sidecar/app/routers/embeddings.py`
- Modify: `sidecar/app/main.py`
- Test: `sidecar/tests/test_embeddings_router.py`

**Interfaces:**
- Consumes: `KureEncoder` (Task 3), `EmbedRequest`/`EmbedResponse` (Task 1).
- Produces: HTTP `POST /embed` → `EmbedResponse`. lifespan에서 `app.state.embedder = KureEncoder(settings.EMBED_MODEL, settings.EMBED_MODEL_VERSION, settings.EMBED_DEVICE)`(모델 미로드), `app.state.embed_lock = asyncio.Lock()`.

- [ ] **Step 1: Write the failing test** — append to `sidecar/tests/test_embeddings_router.py`

```python
import pytest
from fastapi.testclient import TestClient


class _StubEncoder:
    model_version = "kure-v1"
    dim = 4
    def encode(self, texts):
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_router.py -q`
Expected: FAIL — 404 (route 없음) 또는 import 에러

- [ ] **Step 3: Create router** — `sidecar/app/routers/embeddings.py`

```python
"""임베딩 라우터 — folder-chat 의미검색용 KURE-v1 임베딩."""
import logging

from fastapi import APIRouter, Request

from app.schemas import EmbedRequest, EmbedResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest, http_request: Request) -> EmbedResponse:
    encoder = http_request.app.state.embedder
    if not request.texts:
        return EmbedResponse(embeddings=[], model=encoder.model_version, dim=encoder.dim or 0)
    # GPU/모델 동시 접근 직렬화 (STT Metal 충돌·스레드 안전)
    lock = http_request.app.state.embed_lock
    async with lock:
        vectors = encoder.encode(request.texts)
    return EmbedResponse(embeddings=vectors, model=encoder.model_version, dim=encoder.dim or len(vectors[0]))
```

- [ ] **Step 4: Register in lifespan + router** — edit `sidecar/app/main.py`

In `lifespan`, after `app.state.gpu_lock = asyncio.Lock()` line, add:

```python
    from app.embeddings.encoder import KureEncoder
    from app.config import settings as _settings
    app.state.embedder = KureEncoder(_settings.EMBED_MODEL, _settings.EMBED_MODEL_VERSION, _settings.EMBED_DEVICE)
    app.state.embed_lock = asyncio.Lock()
```

In the router import block, change to include `embeddings`:

```python
from app.routers import embeddings, health, llm, settings as settings_router, speakers, stt
```

and add after `app.include_router(stt.router)`:

```python
app.include_router(embeddings.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd sidecar && .venv/bin/python -m pytest tests/test_embeddings_router.py -q`
Expected: PASS (4 passed). (`TestClient(app)`가 lifespan을 실행하지만 KURE는 미로드 — 픽스처가 `app.state.embedder`를 스텁으로 덮음.)

- [ ] **Step 6: Run full sidecar suite (회귀 없음 확인)**

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: 기존 + 신규 통과(임베딩 관련 실패 0).

- [ ] **Step 7: Commit**

```bash
git add sidecar/app/routers/embeddings.py sidecar/app/main.py sidecar/tests/test_embeddings_router.py
git commit -m "feat(embed): POST /embed 라우터 + lifespan 등록"
```

---

## Phase 2 — Rails 저장·동기화·백필

### Task 5: numo-narray + 마이그레이션 + TranscriptEmbedding 모델

**Files:**
- Modify: `backend/Gemfile`
- Create: `backend/db/migrate/20260619000001_create_transcript_embeddings.rb`
- Create: `backend/app/models/transcript_embedding.rb`
- Test: `backend/spec/models/transcript_embedding_spec.rb`

**Interfaces:**
- Produces: `TranscriptEmbedding`(belongs_to :transcript) with `MODEL_VERSION="kure-v1"`, `DIM=1024`, class methods `pack_vector(Array<Float>)->String`, `unpack_vector(String)->Array<Float>`, instance `#vector->Array<Float>`. 테이블 컬럼: `transcript_id`(uniq), `meeting_id`(idx), `model_version`, `dim`, `embedding`(binary), timestamps.

- [ ] **Step 1: Add gem + bundle**

In `backend/Gemfile`, add near other gems (e.g. after `gem "sqlite3"`):

```ruby
gem "numo-narray"  # 벡터 brute-force cosine (folder-chat 의미검색)
```

Run: `cd backend && bundle install`
Expected: `Bundle complete`. (numo-narray 0.9.2.1 네이티브 빌드 — Phase 0서 확인됨.)

- [ ] **Step 2: Write the failing test** — `backend/spec/models/transcript_embedding_spec.rb`

```ruby
require "rails_helper"

RSpec.describe TranscriptEmbedding, type: :model do
  it "pack/unpack roundtrips fp32 vectors" do
    vec = [0.1, -0.2, 0.3, 1.5]
    blob = TranscriptEmbedding.pack_vector(vec)
    back = TranscriptEmbedding.unpack_vector(blob)
    expect(back.map { |x| x.round(4) }).to eq([0.1, -0.2, 0.3, 1.5])
  end

  it "stores and reads an embedding row" do
    t = create(:transcript)
    rec = TranscriptEmbedding.create!(
      transcript: t, meeting_id: t.meeting_id,
      model_version: TranscriptEmbedding::MODEL_VERSION, dim: 4,
      embedding: TranscriptEmbedding.pack_vector([1.0, 0.0, 0.0, 0.0])
    )
    expect(rec.reload.vector.map { |x| x.round(2) }).to eq([1.0, 0.0, 0.0, 0.0])
  end

  it "enforces unique transcript_id" do
    t = create(:transcript)
    attrs = { transcript: t, meeting_id: t.meeting_id, model_version: "kure-v1", dim: 1, embedding: TranscriptEmbedding.pack_vector([1.0]) }
    TranscriptEmbedding.create!(attrs)
    expect { TranscriptEmbedding.create!(attrs) }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && bundle exec rspec spec/models/transcript_embedding_spec.rb`
Expected: FAIL — `uninitialized constant TranscriptEmbedding`

- [ ] **Step 4: Create migration**

`backend/db/migrate/20260619000001_create_transcript_embeddings.rb`:

```ruby
class CreateTranscriptEmbeddings < ActiveRecord::Migration[8.1]
  def change
    create_table :transcript_embeddings do |t|
      t.integer :transcript_id, null: false
      t.integer :meeting_id, null: false
      t.string  :model_version, null: false
      t.integer :dim, null: false
      t.binary  :embedding, null: false
      t.timestamps
    end
    add_index :transcript_embeddings, :transcript_id, unique: true
    add_index :transcript_embeddings, [:meeting_id, :model_version]
    add_foreign_key :transcript_embeddings, :transcripts, on_delete: :cascade
  end
end
```

> 신규 테이블 단순 생성 — 과거 와이프 클래스(테이블 재생성/FK cascade) 아님. `disable_ddl_transaction!` 불필요.

- [ ] **Step 5: Create model** — `backend/app/models/transcript_embedding.rb`

```ruby
# 전사 행 단위 임베딩(brute-force 의미검색). fp32 LE BLOB 저장.
# ⚠️ vector store 추상화의 저장층 — 검색은 TranscriptVectorSearch 경유.
class TranscriptEmbedding < ApplicationRecord
  MODEL_VERSION = "kure-v1".freeze
  DIM = 1024

  belongs_to :transcript

  def self.pack_vector(floats)
    floats.map(&:to_f).pack("e*") # little-endian float32
  end

  def self.unpack_vector(blob)
    blob.to_s.unpack("e*")
  end

  def vector
    self.class.unpack_vector(embedding)
  end
end
```

- [ ] **Step 6: Migrate + run test**

Run: `cd backend && bundle exec rails db:migrate && bundle exec rspec spec/models/transcript_embedding_spec.rb`
Expected: migrate OK, spec PASS (3 examples).

- [ ] **Step 7: Commit**

```bash
git add backend/Gemfile backend/Gemfile.lock backend/db/migrate/20260619000001_create_transcript_embeddings.rb backend/db/schema.rb backend/app/models/transcript_embedding.rb backend/spec/models/transcript_embedding_spec.rb
git commit -m "feat(embed): transcript_embeddings 테이블·모델 + numo-narray"
```

---

### Task 6: SidecarClient#embed

**Files:**
- Modify: `backend/app/services/sidecar_client.rb`
- Test: `backend/spec/services/sidecar_client_embed_spec.rb`

**Interfaces:**
- Produces: `SidecarClient#embed(texts) -> Array<Array<Float>>` (`/embed` POST 후 `resp["embeddings"]` 반환). 타임아웃 `SIDECAR_EMBED_TIMEOUT`(기본 120s).

- [ ] **Step 1: Write the failing test** — `backend/spec/services/sidecar_client_embed_spec.rb`

```ruby
require "rails_helper"

RSpec.describe SidecarClient, "#embed", type: :service do
  let(:client) { described_class.new }
  let(:mock_http) { instance_double(Net::HTTP) }

  before do
    allow(Net::HTTP).to receive(:new).and_return(mock_http)
    allow(mock_http).to receive(:open_timeout=)
    allow(mock_http).to receive(:read_timeout=)
    allow(mock_http).to receive(:keep_alive_timeout=)
    allow(mock_http).to receive(:start).and_yield(mock_http)
  end

  it "POSTs texts and returns embeddings array" do
    resp = instance_double(Net::HTTPResponse, code: "200",
      body: { embeddings: [[0.1, 0.2]], model: "kure-v1", dim: 2 }.to_json)
    expect(mock_http).to receive(:request).with(instance_of(Net::HTTP::Post)).and_return(resp)

    result = client.embed(["회의 예산"])
    expect(result).to eq([[0.1, 0.2]])
  end

  it "raises SidecarError on 500" do
    resp = instance_double(Net::HTTPResponse, code: "500", body: { error: "boom" }.to_json)
    allow(mock_http).to receive(:request).and_return(resp)
    expect { client.embed(["x"]) }.to raise_error(SidecarClient::SidecarError, /500/)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bundle exec rspec spec/services/sidecar_client_embed_spec.rb`
Expected: FAIL — `undefined method 'embed'`

- [ ] **Step 3: Add #embed** — in `backend/app/services/sidecar_client.rb`, add a public method after the `# ── HuggingFace ──` section (before `private`):

```ruby
  # ── Embeddings ──

  # 텍스트 배열 → 임베딩 벡터 배열. folder-chat 의미검색용.
  def embed(texts)
    resp = post("/embed", { texts: Array(texts) },
                timeout: ENV.fetch("SIDECAR_EMBED_TIMEOUT", "120").to_i)
    resp["embeddings"]
  end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && bundle exec rspec spec/services/sidecar_client_embed_spec.rb`
Expected: PASS (2 examples).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/sidecar_client.rb backend/spec/services/sidecar_client_embed_spec.rb
git commit -m "feat(embed): SidecarClient#embed"
```

---

### Task 7: Embeddable concern + EmbedTranscriptJob

**Files:**
- Create: `backend/app/models/concerns/embeddable.rb`
- Modify: `backend/app/models/transcript.rb`
- Create: `backend/app/jobs/embed_transcript_job.rb`
- Test: `backend/spec/models/transcript_embeddable_spec.rb`, `backend/spec/jobs/embed_transcript_job_spec.rb`

**Interfaces:**
- Consumes: `TranscriptEmbedding` (Task 5), `SidecarClient#embed` (Task 6).
- Produces: `Embeddable` concern w/ class macro `embeddable(content_column: :content)` → `after_commit` enqueue `EmbedTranscriptJob` when content changed & present. `EmbedTranscriptJob.perform(transcript_id)` upserts `TranscriptEmbedding`.

> ⚠️ **테스트 하네스 전제(이 태스크 전 반드시 확인)**: `have_enqueued_job`은 ActiveJob `:test` 어댑터에서만 동작한다. 또 `Embeddable`은 `after_commit`을 쓰므로 transactional fixtures(use_transactional_fixtures=true)에서 콜백이 실제로 발동해야 한다.
> **만약 Step 0 spike가 RED면 테스트를 약화시키지 말 것**(예: `have_enqueued_job` → `TranscriptEmbedding` count로 바꾸는 식 금지). 대신 하네스를 고친다: `config/environments/test.rb`에 `config.active_job.queue_adapter = :test` 추가. (현 레포는 기존 스펙 다수가 `have_enqueued_job`을 통과시키므로 `:test`로 추정되나, spike로 확정한다.)

- [ ] **Step 0: 하네스 spike (전제 확정)** — `backend/spec/models/transcript_embeddable_spec.rb`에 임시로 다음만 작성 후 실행:

```ruby
require "rails_helper"
RSpec.describe "embed enqueue harness", type: :model do
  include ActiveJob::TestHelper
  it "after_commit 콜백이 transactional fixtures에서 잡을 enqueue한다 (전제 확인)" do
    # 이 시점엔 Embeddable 미적용 → 잡 enqueue 0건. 어댑터/transactional 동작만 sanity.
    expect(ActiveJob::Base.queue_adapter_name).to eq("test")
  end
end
```

Run: `cd backend && bundle exec rspec spec/models/transcript_embeddable_spec.rb`
- GREEN(`queue_adapter_name == "test"`) → 전제 충족, Step 1로. (이 임시 파일은 Step 1에서 본 테스트로 덮어쓴다.)
- RED → `config/environments/test.rb`에 `config.active_job.queue_adapter = :test` 추가 후 재실행. 그래도 RED면 멈추고 보고.

- [ ] **Step 1: Write the failing job test** — `backend/spec/jobs/embed_transcript_job_spec.rb`

```ruby
require "rails_helper"

RSpec.describe EmbedTranscriptJob, type: :job do
  let(:transcript) { create(:transcript, content: "분기 예산을 오천만원으로 확정") }
  let(:sidecar) { instance_double(SidecarClient) }

  before { allow(SidecarClient).to receive(:new).and_return(sidecar) }

  it "임베딩을 받아 transcript_embeddings에 upsert한다" do
    allow(sidecar).to receive(:embed).with([transcript.content]).and_return([[1.0, 0.0, 0.0]])
    expect {
      described_class.perform_now(transcript.id)
    }.to change(TranscriptEmbedding, :count).by(1)
    rec = TranscriptEmbedding.find_by(transcript_id: transcript.id)
    expect(rec.meeting_id).to eq(transcript.meeting_id)
    expect(rec.model_version).to eq("kure-v1")
    expect(rec.vector.map { |x| x.round(2) }).to eq([1.0, 0.0, 0.0])
  end

  it "재실행 시 갱신(중복 생성 안 함)" do
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]], [[0.0, 1.0]])
    described_class.perform_now(transcript.id)
    expect { described_class.perform_now(transcript.id) }.not_to change(TranscriptEmbedding, :count)
    expect(TranscriptEmbedding.find_by(transcript_id: transcript.id).vector.map { |x| x.round(2) }).to eq([0.0, 1.0])
  end

  it "content가 비면 skip" do
    blank = create(:transcript, content: "x")
    blank.update_column(:content, "")
    expect(sidecar).not_to receive(:embed)
    expect { described_class.perform_now(blank.id) }.not_to change(TranscriptEmbedding, :count)
  end

  it "없는 id는 조용히 무시" do
    expect { described_class.perform_now(-1) }.not_to raise_error
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/jobs/embed_transcript_job_spec.rb`
Expected: FAIL — `uninitialized constant EmbedTranscriptJob`

- [ ] **Step 3: Create job** — `backend/app/jobs/embed_transcript_job.rb`

```ruby
# 전사 1건을 sidecar /embed로 임베딩 → transcript_embeddings upsert.
# 실패는 ActiveJob 재시도. FTS는 항상 fresh라 검색 graceful 저하.
class EmbedTranscriptJob < ApplicationJob
  queue_as :default

  def perform(transcript_id)
    t = Transcript.find_by(id: transcript_id)
    return if t.nil? || t.content.blank?

    vecs = SidecarClient.new.embed([t.content])
    vec = vecs&.first
    return if vec.blank?

    rec = TranscriptEmbedding.find_or_initialize_by(transcript_id: t.id)
    rec.meeting_id     = t.meeting_id
    rec.model_version  = TranscriptEmbedding::MODEL_VERSION
    rec.dim            = vec.size
    rec.embedding      = TranscriptEmbedding.pack_vector(vec)
    rec.save!
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && bundle exec rspec spec/jobs/embed_transcript_job_spec.rb`
Expected: PASS (4 examples).

- [ ] **Step 5: Write the failing concern test** — `backend/spec/models/transcript_embeddable_spec.rb`

```ruby
require "rails_helper"

RSpec.describe "Transcript embedding sync", type: :model do
  include ActiveJob::TestHelper

  it "생성 시 EmbedTranscriptJob을 enqueue한다" do
    expect {
      create(:transcript, content: "안건 논의")
    }.to have_enqueued_job(EmbedTranscriptJob)
  end

  it "content 변경 시 enqueue한다" do
    t = create(:transcript, content: "처음")
    expect {
      t.update!(content: "수정됨")
    }.to have_enqueued_job(EmbedTranscriptJob).with(t.id)
  end

  it "content 외 컬럼만 바뀌면 enqueue 안 함" do
    t = create(:transcript, content: "고정")
    expect {
      t.update!(speaker_name: "김철수")
    }.not_to have_enqueued_job(EmbedTranscriptJob)
  end
end
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/models/transcript_embeddable_spec.rb`
Expected: FAIL — job not enqueued (concern 없음).

- [ ] **Step 7: Create concern + include**

`backend/app/models/concerns/embeddable.rb`:

```ruby
# FtsIndexable 미러. content 변경시에만 비동기 임베딩 잡 enqueue(after_commit).
# 임베딩은 비싸므로 FTS처럼 blind upsert하지 않는다.
module Embeddable
  extend ActiveSupport::Concern

  class_methods do
    def embeddable(content_column: :content)
      after_commit :enqueue_embedding, on: [:create, :update]
      define_method(:embeddable_content_column) { content_column }
    end
  end

  private

  def enqueue_embedding
    col = embeddable_content_column.to_s
    return unless saved_change_to_attribute?(col)
    return if send(col).blank?

    EmbedTranscriptJob.perform_later(id)
  end
end
```

In `backend/app/models/transcript.rb`, after the `fts_table ...` line add:

```ruby
  include Embeddable
  embeddable content_column: :content
```

- [ ] **Step 8: Run both specs**

Run: `cd backend && bundle exec rspec spec/models/transcript_embeddable_spec.rb spec/jobs/embed_transcript_job_spec.rb`
Expected: PASS (3 + 4 examples).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/concerns/embeddable.rb backend/app/models/transcript.rb backend/app/jobs/embed_transcript_job.rb backend/spec/models/transcript_embeddable_spec.rb backend/spec/jobs/embed_transcript_job_spec.rb
git commit -m "feat(embed): Embeddable concern + EmbedTranscriptJob (content dirty-check)"
```

---

### Task 8: EmbedBackfillJob + rake

**Files:**
- Create: `backend/app/jobs/embed_backfill_job.rb`
- Create: `backend/lib/tasks/embeddings.rake`
- Test: `backend/spec/jobs/embed_backfill_job_spec.rb`

**Interfaces:**
- Consumes: `EmbedTranscriptJob` 로직(여기선 직접 sidecar 배치 호출), `TranscriptEmbedding`.
- Produces: `EmbedBackfillJob.perform(batch_size: 64)` — 임베딩 없거나 `model_version != MODEL_VERSION`인 전사를 배치로 임베딩·upsert, **idempotent**. rake `embeddings:backfill`.

- [ ] **Step 1: Write the failing test** — `backend/spec/jobs/embed_backfill_job_spec.rb`

```ruby
require "rails_helper"

RSpec.describe EmbedBackfillJob, type: :job do
  let(:sidecar) { instance_double(SidecarClient) }
  before do
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    # 호출되는 텍스트 수만큼 더미 벡터 반환
    allow(sidecar).to receive(:embed) { |texts| texts.map { [1.0, 0.0] } }
  end

  it "임베딩 없는 전사를 전부 채운다" do
    3.times { |i| create(:transcript, content: "내용 #{i}") }
    TranscriptEmbedding.delete_all # 콜백으로 enqueue만 됐을 수 있으니 정리
    expect {
      described_class.perform_now(batch_size: 2)
    }.to change(TranscriptEmbedding, :count).by(3)
  end

  it "idempotent — 두 번 돌려도 중복 생성 없음" do
    2.times { |i| create(:transcript, content: "x#{i}") }
    TranscriptEmbedding.delete_all
    described_class.perform_now
    expect { described_class.perform_now }.not_to change(TranscriptEmbedding, :count)
  end

  it "구버전 model_version 행만 재처리한다" do
    t = create(:transcript, content: "재처리 대상")
    TranscriptEmbedding.delete_all
    TranscriptEmbedding.create!(transcript: t, meeting_id: t.meeting_id, model_version: "old-v0", dim: 2, embedding: TranscriptEmbedding.pack_vector([0.0, 0.0]))
    described_class.perform_now
    rec = TranscriptEmbedding.find_by(transcript_id: t.id)
    expect(rec.model_version).to eq("kure-v1")
    expect(rec.vector.map { |x| x.round(1) }).to eq([1.0, 0.0])
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/jobs/embed_backfill_job_spec.rb`
Expected: FAIL — `uninitialized constant EmbedBackfillJob`

- [ ] **Step 3: Create job** — `backend/app/jobs/embed_backfill_job.rb`

```ruby
# 임베딩 없거나 구버전 model_version인 전사를 배치 임베딩·upsert. 재실행 가능(idempotent).
# 초기 적재 + 모델 교체 재임베딩에 사용. 1회성 스크립트 금지 — 항상 이 잡 경유.
class EmbedBackfillJob < ApplicationJob
  queue_as :default

  def perform(batch_size: 64)
    pending_transcript_ids.each_slice(batch_size) do |ids|
      transcripts = Transcript.where(id: ids).where.not(content: [nil, ""]).to_a
      next if transcripts.empty?

      vecs = SidecarClient.new.embed(transcripts.map(&:content))
      transcripts.each_with_index do |t, i|
        vec = vecs[i]
        next if vec.blank?
        rec = TranscriptEmbedding.find_or_initialize_by(transcript_id: t.id)
        rec.meeting_id    = t.meeting_id
        rec.model_version = TranscriptEmbedding::MODEL_VERSION
        rec.dim           = vec.size
        rec.embedding     = TranscriptEmbedding.pack_vector(vec)
        rec.save!
      end
    end
  end

  private

  # 현 모델 버전 임베딩이 없는 전사 id. (없음 OR 구버전 둘 다 포함)
  def pending_transcript_ids
    current = TranscriptEmbedding.where(model_version: TranscriptEmbedding::MODEL_VERSION).select(:transcript_id)
    Transcript.where.not(id: current).where.not(content: [nil, ""]).pluck(:id)
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && bundle exec rspec spec/jobs/embed_backfill_job_spec.rb`
Expected: PASS (3 examples).

- [ ] **Step 5: Create rake task** — `backend/lib/tasks/embeddings.rake`

```ruby
namespace :embeddings do
  desc "임베딩 없거나 구버전인 전사를 백필(재실행 가능)"
  task backfill: :environment do
    EmbedBackfillJob.perform_now
    puts "[embeddings:backfill] 완료 — 임베딩 #{TranscriptEmbedding.count}건"
  end
end
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/jobs/embed_backfill_job.rb backend/lib/tasks/embeddings.rake backend/spec/jobs/embed_backfill_job_spec.rb
git commit -m "feat(embed): EmbedBackfillJob + embeddings:backfill rake (idempotent)"
```

---

## Phase 3 — 검색 + 하이브리드

### Task 9: TranscriptVectorSearch (브루트포스 cosine)

**Files:**
- Create: `backend/app/services/transcript_vector_search.rb`
- Test: `backend/spec/services/transcript_vector_search_spec.rb`

**Interfaces:**
- Consumes: `SidecarClient#embed`, `TranscriptEmbedding`, `Numo::SFloat`.
- Produces: `TranscriptVectorSearch.search(query_text:, meeting_ids:, limit: 40) -> Array<{transcript_id:, score:}>` (score 내림차순). 빈 입력/빈 후보 → `[]`. `meeting_ids`·`model_version` 필터 필수(인가). sidecar 실패는 예외 전파(호출측이 rescue).

- [ ] **Step 1: Write the failing test** — `backend/spec/services/transcript_vector_search_spec.rb`

```ruby
require "rails_helper"

RSpec.describe TranscriptVectorSearch, type: :service do
  let(:sidecar) { instance_double(SidecarClient) }
  before { allow(SidecarClient).to receive(:new).and_return(sidecar) }

  def embed_row(transcript, vec)
    TranscriptEmbedding.create!(transcript: transcript, meeting_id: transcript.meeting_id,
      model_version: "kure-v1", dim: vec.size, embedding: TranscriptEmbedding.pack_vector(vec))
  end

  let(:meeting) { create(:meeting) }
  let!(:t_near) { create(:transcript, meeting: meeting, content: "가깝다") }
  let!(:t_far)  { create(:transcript, meeting: meeting, content: "멀다") }

  before do
    TranscriptEmbedding.delete_all
    embed_row(t_near, [1.0, 0.0])   # 쿼리와 동일 방향
    embed_row(t_far,  [0.0, 1.0])   # 직교
  end

  it "쿼리에 가까운 전사를 먼저 반환한다" do
    allow(sidecar).to receive(:embed).with(["q"]).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    expect(res.first[:transcript_id]).to eq(t_near.id)
    expect(res.first[:score]).to be > res.last[:score]
  end

  it "meeting_ids 밖 전사는 절대 포함하지 않는다 (인가)" do
    other_mtg = create(:meeting)
    other_t = create(:transcript, meeting: other_mtg, content: "타인")
    embed_row(other_t, [1.0, 0.0]) # 쿼리와 완벽 일치하지만 스코프 밖
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    ids = res.map { |r| r[:transcript_id] }
    expect(ids).not_to include(other_t.id)
  end

  it "현 MODEL_VERSION만 매칭한다" do
    stale = create(:transcript, meeting: meeting, content: "구버전")
    TranscriptEmbedding.create!(transcript: stale, meeting_id: meeting.id, model_version: "old", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]])
    res = described_class.search(query_text: "q", meeting_ids: [meeting.id], limit: 10)
    expect(res.map { |r| r[:transcript_id] }).not_to include(stale.id)
  end

  it "빈 meeting_ids/빈 쿼리는 빈 배열" do
    expect(described_class.search(query_text: "", meeting_ids: [meeting.id])).to eq([])
    expect(described_class.search(query_text: "q", meeting_ids: [])).to eq([])
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/services/transcript_vector_search_spec.rb`
Expected: FAIL — `uninitialized constant TranscriptVectorSearch`

- [ ] **Step 3: Implement** — `backend/app/services/transcript_vector_search.rb`

```ruby
require "numo/narray"

# 의미검색(브루트포스 exact cosine). VectorIndex 추상화 — 추후 pgvector 교체 지점.
# 벡터는 저장 시 L2 정규화돼 있으므로 dot product = cosine.
# ⚠️ meeting_ids·model_version 필터가 인가 경계 — 빼면 privilege escalation.
class TranscriptVectorSearch
  def self.search(query_text:, meeting_ids:, limit: 40)
    new(query_text, meeting_ids, limit).search
  end

  def initialize(query_text, meeting_ids, limit)
    @query_text  = query_text.to_s
    @meeting_ids = Array(meeting_ids)
    @limit       = limit
  end

  def search
    return [] if @query_text.blank? || @meeting_ids.empty?

    qvec = SidecarClient.new.embed([@query_text])&.first
    return [] if qvec.blank?

    rows = TranscriptEmbedding
             .where(meeting_id: @meeting_ids, model_version: TranscriptEmbedding::MODEL_VERSION)
             .pluck(:transcript_id, :embedding)
    return [] if rows.empty?

    q = Numo::SFloat.cast(qvec)
    mat = Numo::SFloat.zeros(rows.size, qvec.size)
    rows.each_with_index { |(_, blob), i| mat[i, true] = Numo::SFloat.cast(blob.unpack("e*")) }

    scores = mat.dot(q)                       # (n,) cosine
    order = scores.sort_index.to_a.reverse    # 내림차순 인덱스
    order.first(@limit).map { |i| { transcript_id: rows[i][0], score: scores[i].to_f } }
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && bundle exec rspec spec/services/transcript_vector_search_spec.rb`
Expected: PASS (4 examples).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/transcript_vector_search.rb backend/spec/services/transcript_vector_search_spec.rb
git commit -m "feat(embed): TranscriptVectorSearch brute-force cosine (auth-filtered)"
```

---

### Task 10: FolderChatContext 하이브리드 RRF

**Files:**
- Modify: `backend/app/services/folder_chat_context.rb`
- Test: `backend/spec/services/folder_chat_context_hybrid_spec.rb`

**Interfaces:**
- Consumes: `TranscriptVectorSearch.search`, 기존 FTS 쿼리.
- Produces: `FolderChatContext.build(scope_type:, scope_id:, user:, keywords:, query_text: nil)` — `excerpts_block`이 FTS 랭크 + 벡터 랭크를 RRF(k=60) 융합. 벡터/sidecar 실패 시 FTS-only fallback. `RRF_K = 60`.

- [ ] **Step 1: Write the failing test** — `backend/spec/services/folder_chat_context_hybrid_spec.rb`

```ruby
require "rails_helper"

RSpec.describe FolderChatContext, "hybrid retrieval", type: :service do
  let(:project) { create(:project) }
  let(:user) { project.creator }
  let(:folder) { create(:folder, project: project) }
  let(:meeting) { create(:meeting, project: project, creator: user, folder: folder) }

  let!(:t_kw)  { create(:transcript, meeting: meeting, content: "예산 배정 논의", speaker_label: "화자1") }
  let!(:t_sem) { create(:transcript, meeting: meeting, content: "비용 집행 계획", speaker_label: "화자2") }

  before do
    ActiveRecord::Base.connection.execute("DELETE FROM transcripts_fts")
    # FTS 재색인(콜백이 이미 넣었을 수 있으나 명시)
    [t_kw, t_sem].each(&:save!)
    TranscriptEmbedding.delete_all
    # 벡터: 의미상 t_sem이 쿼리에 가깝다고 가정
    TranscriptEmbedding.create!(transcript: t_sem, meeting_id: meeting.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    TranscriptEmbedding.create!(transcript: t_kw,  meeting_id: meeting.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([0.0, 1.0]))
    sidecar = instance_double(SidecarClient)
    allow(SidecarClient).to receive(:new).and_return(sidecar)
    allow(sidecar).to receive(:embed).and_return([[1.0, 0.0]]) # t_sem 방향
  end

  it "FTS 키워드 히트와 벡터 의미 히트를 모두 발췌에 포함한다" do
    ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                keywords: ["예산"], query_text: "비용은 어떻게 쓰나")
    block = ctx[:user_content]
    expect(block).to include("예산 배정 논의")  # FTS 히트
    expect(block).to include("비용 집행 계획")  # 벡터 히트(키워드 '예산' 없음)
  end

  it "sidecar 실패 시 FTS-only로 fallback (예외 안 남)" do
    allow(SidecarClient).to receive(:new).and_raise(SidecarClient::ConnectionError, "down")
    ctx = nil
    expect {
      ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                  keywords: ["예산"], query_text: "비용")
    }.not_to raise_error
    expect(ctx[:user_content]).to include("예산 배정 논의")
  end

  it "스코프 밖 회의 전사는 발췌에 노출되지 않는다 (인가)" do
    other = create(:meeting, project: create(:project), creator: create(:user))
    secret = create(:transcript, meeting: other, content: "비밀 예산 비용")
    secret.save!
    TranscriptEmbedding.create!(transcript: secret, meeting_id: other.id, model_version: "kure-v1", dim: 2, embedding: TranscriptEmbedding.pack_vector([1.0, 0.0]))
    ctx = described_class.build(scope_type: "folder", scope_id: folder.id, user: user,
                                keywords: ["예산"], query_text: "비용")
    expect(ctx[:user_content]).not_to include("비밀 예산 비용")
  end
end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_context_hybrid_spec.rb`
Expected: FAIL — 벡터 히트("비용 집행 계획") 미포함, 또는 `query_text` 인자 에러.

- [ ] **Step 3: Rewrite FolderChatContext** — replace `backend/app/services/folder_chat_context.rb` with:

```ruby
# 폴더/프로젝트 챗 컨텍스트: 스코프 회의 ∩ 사용자 접근권 → 하이브리드(FTS+벡터 RRF) 발췌 + 목차 + history.
# ⚠️ SearchService#accessible_meeting_ids는 Meeting.kept만 쓰므로 재사용 금지 — 여기선 accessible_by(user)로 인가한다.
# ⚠️ FTS·벡터 두 경로 모두 동일 meeting_ids로 필터 — privilege escalation 방지.
class FolderChatContext
  MAX_CHARS   = 120_000
  TOP_K       = 40       # 융합 후 발췌 행 상한
  SNIPPET_LEN = 32
  EXCERPT_LEN = 160      # 벡터 전용 히트(FTS snippet 없음) 본문 절단 길이
  RRF_K       = 60       # Reciprocal Rank Fusion 상수

  def self.build(scope_type:, scope_id:, user:, keywords:, query_text: nil)
    new(scope_type, scope_id, user, keywords, query_text).build
  end

  def initialize(scope_type, scope_id, user, keywords, query_text = nil)
    @scope_type = scope_type
    @scope_id   = scope_id
    @user       = user
    @keywords   = Array(keywords).reject(&:blank?)
    @query_text = query_text.to_s
  end

  def build
    parts = []
    parts << "스코프: #{@scope_type} ##{@scope_id} (회의 #{meeting_ids.size}건)"
    parts << "회의 목차:\n#{toc_block}" if toc_block.present?
    parts << "관련 회의 발췌:\n#{excerpts_block}" if excerpts_block.present?
    parts << history_block if history_block.present?
    { system_prompt: LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT, user_content: truncate(parts.join("\n\n")) }
  end

  private

  def meeting_ids
    @meeting_ids ||= begin
      scoped = case @scope_type
      when "folder"
        ids = Folder.find_by(id: @scope_id)&.subtree_ids || []
        Meeting.where(folder_id: ids)
      when "project"
        Meeting.where(project_id: @scope_id)
      else
        Meeting.none
      end
      scoped.merge(Meeting.accessible_by(@user)).pluck(:id)
    end
  end

  def fts_query
    @keywords.map { |w| "\"#{w.gsub('"', '')}\"*" }.join(" OR ")
  end

  # FTS 랭크: [transcript_id, ...] 순위. snippet은 @fts_snippets[id]에 저장.
  def fts_ranked_ids
    return [] if meeting_ids.empty? || @keywords.empty?

    placeholders = meeting_ids.map { "?" }.join(",")
    sql = <<~SQL
      SELECT transcripts_fts.source_id AS tid,
             snippet(transcripts_fts, 0, '', '', '…', #{SNIPPET_LEN}) AS snippet
      FROM transcripts_fts
      JOIN transcripts t ON t.id = transcripts_fts.source_id
      WHERE transcripts_fts MATCH ? AND t.meeting_id IN (#{placeholders})
      ORDER BY rank
      LIMIT #{TOP_K}
    SQL
    binds = [ fts_query ] + meeting_ids
    rows = ActiveRecord::Base.connection.select_all(
      ActiveRecord::Base.sanitize_sql_array([ sql ] + binds)
    )
    @fts_snippets = {}
    rows.map { |r| id = r["tid"].to_i; @fts_snippets[id] = r["snippet"]; id }
  end

  # 벡터 랭크: [transcript_id, ...]. sidecar/벡터 실패 시 [] (FTS-only fallback).
  def vector_ranked_ids
    return [] if meeting_ids.empty? || @query_text.blank?

    TranscriptVectorSearch.search(query_text: @query_text, meeting_ids: meeting_ids, limit: TOP_K)
                          .map { |h| h[:transcript_id] }
  rescue => e
    Rails.logger.warn("[FolderChatContext] 벡터검색 실패 → FTS-only: #{e.message}")
    []
  end

  # RRF: score(t) = Σ_lists 1/(RRF_K + rank). 내림차순 transcript_id 배열.
  def rrf_merge(*lists)
    scores = Hash.new(0.0)
    lists.each do |list|
      list.each_with_index { |tid, rank| scores[tid] += 1.0 / (RRF_K + rank + 1) }
    end
    scores.sort_by { |_tid, s| -s }.map(&:first)
  end

  def excerpts_block
    return @excerpts_block if defined?(@excerpts_block)
    return @excerpts_block = "" if meeting_ids.empty?

    @fts_snippets = {}
    fts_ids = fts_ranked_ids
    vec_ids = vector_ranked_ids
    return @excerpts_block = "" if fts_ids.empty? && vec_ids.empty?

    ranked = rrf_merge(fts_ids, vec_ids).first(TOP_K)
    @excerpts_block = build_excerpt_lines(ranked)
  end

  # 융합 순서대로 발췌 라인 구성. text = FTS snippet 있으면 그것, 없으면 content 절단.
  def build_excerpt_lines(ranked_ids)
    by_id = Transcript.where(id: ranked_ids).includes(:meeting).index_by(&:id)
    ranked_ids.filter_map { |tid|
      t = by_id[tid]
      next unless t
      ms = t.started_at_ms.to_i
      clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
      spk = t.speaker_label.presence || "화자"
      text = @fts_snippets[tid].presence || t.content.to_s[0, EXCERPT_LEN]
      "[회의:#{t.meeting_id} #{t.meeting&.title}][#{clock}|#{ms}ms #{spk}] #{text}"
    }.join("\n")
  end

  def toc_block
    return @toc_block if defined?(@toc_block)
    @toc_block = Meeting.where(id: meeting_ids).order(created_at: :desc).limit(100).map { |m|
      brief = m.brief_summary.to_s.strip.tr("\n", " ")
      "- [회의:#{m.id}] #{m.title} (#{m.created_at.to_date})#{brief.present? ? " — #{brief}" : ''}"
    }.join("\n")
  end

  def history_block
    return @history_block if defined?(@history_block)
    msgs = ChatMessage.for_scope(@scope_type, @scope_id).for_user(@user)
                      .where(status: "complete").order(:created_at).last(6)
    @history_block = msgs.any? ? "이전 대화:\n" + msgs.map { |m| "#{m.role == 'user' ? '사용자' : '어시스턴트'}: #{m.content}" }.join("\n") : ""
  end

  def truncate(text)
    text.length > MAX_CHARS ? text[0, MAX_CHARS] + "\n…(생략)…" : text
  end
end
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && bundle exec rspec spec/services/folder_chat_context_hybrid_spec.rb`
Expected: PASS (3 examples).

- [ ] **Step 5: Run existing folder_chat_context specs (회귀 없음)**

Run: `cd backend && bundle exec rspec spec/services/ -e FolderChatContext`
Expected: 기존 발췌/목차/history 스펙 통과.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/folder_chat_context.rb backend/spec/services/folder_chat_context_hybrid_spec.rb
git commit -m "feat(embed): FolderChatContext 하이브리드 FTS+벡터 RRF (query_text, fallback)"
```

---

### Task 11: FolderChatJob에서 query_text 전달

**Files:**
- Modify: `backend/app/jobs/folder_chat_job.rb`
- Test: `backend/spec/jobs/folder_chat_job_spec.rb` (기존 spec에 케이스 추가)

**Interfaces:**
- Consumes: `FolderChatContext.build(..., query_text:)`.
- Produces: `FolderChatJob`이 질문 content를 `query_text`로 전달.

- [ ] **Step 1: Write the failing test** — append to `backend/spec/jobs/folder_chat_job_spec.rb`

```ruby
  it "질문 content를 query_text로 FolderChatContext에 넘긴다" do
    expect(FolderChatContext).to receive(:build).with(
      hash_including(query_text: "예산?")
    ).and_return({ system_prompt: "sp", user_content: "uc" })
    FolderChatJob.perform_now(answer.id)
  end
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && bundle exec rspec spec/jobs/folder_chat_job_spec.rb -e "query_text"`
Expected: FAIL — `build` called without `query_text`.

- [ ] **Step 3: Edit job** — in `backend/app/jobs/folder_chat_job.rb`, change the `FolderChatContext.build(...)` call to pass `query_text`:

```ruby
    ctx = FolderChatContext.build(scope_type: answer.scope_type, scope_id: answer.scope_id, user: user, keywords: keywords, query_text: question&.content)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && bundle exec rspec spec/jobs/folder_chat_job_spec.rb`
Expected: PASS (전체 — 기존 + 신규).

- [ ] **Step 5: Commit**

```bash
git add backend/app/jobs/folder_chat_job.rb backend/spec/jobs/folder_chat_job_spec.rb
git commit -m "feat(embed): FolderChatJob이 query_text 전달(벡터검색 활성화)"
```

---

## Phase 4 — 의존성 선언 · 백필 · 문서

### Task 12: pyproject torch 선언 + 전체 테스트 + 백필 + 문서화

**Files:**
- Modify: `sidecar/pyproject.toml`
- Modify: `docs/superpowers/specs/2026-06-19-folder-chat-embedding-design.md` (구현 완료·결정 기록)

**Interfaces:** 없음(마무리 태스크).

- [ ] **Step 1: torch를 pyproject에 정식 선언**

In `sidecar/pyproject.toml`, add `torch` to `dependencies` (Phase 0서 venv에 이미 있으나 lock 미선언 → 재현/배포 위해 명시). Add line in the `dependencies = [...]` list:

```toml
    "torch>=2.4",
```

Run: `cd sidecar && uv lock`
Expected: lock 갱신, transformers 5.3.0 다운그레이드 없음(확인: `grep -A1 'name = "transformers"' uv.lock` 가 5.3.0 유지). 다운그레이드 발생 시 → `torch>=2.11`로 상향 후 재시도, 그래도면 spec §11 실패분기 기록.

추가 검증 — Phase 0 보장은 torch×transformers×**mlx** 공존이므로 re-lock 후 mlx 깨짐 없음 확인:

Run: `cd sidecar && .venv/bin/python -c "import mlx_lm, mlx_audio, transformers, torch; print('coexist OK', transformers.__version__, torch.__version__)"`
Expected: `coexist OK 5.3.0 ...`. import 실패 시 lock 되돌리고(`git checkout uv.lock pyproject.toml`) 보고.

- [ ] **Step 2: 전체 테스트 (백엔드 + sidecar)**

Run: `cd backend && bundle exec rspec`
Expected: 전체 그린(신규 임베딩 스펙 포함, 회귀 0).

Run: `cd sidecar && .venv/bin/python -m pytest -q`
Expected: 전체 그린.

- [ ] **Step 3: 실데이터 백필 (sidecar 기동 필요)**

먼저 sidecar가 떠 있어야 함(`/embed` 호출). 기동 상태 확인 후:

Run: `cd backend && bundle exec rails embeddings:backfill`
Expected: `[embeddings:backfill] 완료 — 임베딩 N건` (N ≈ Transcript.count). 소요시간 로깅(CPU). 중단 시 재실행으로 이어서.

> sidecar 미기동/장애 시 백필은 실패해도 기능은 FTS로 동작 — 추후 재실행 가능.

- [ ] **Step 4: 설계 문서에 구현 완료·결정 기록**

`docs/superpowers/specs/2026-06-19-folder-chat-embedding-design.md` 끝에 "## 13. 구현 결과(2026-06-19)" 섹션 추가: 구현된 컴포넌트 목록, 자동 선택한 결정(예: `EXCERPT_LEN=160`, `RRF_K=60`, torch 버전 핀, 백필 N건·소요시간), 잔여(수동 E2E·머지).

- [ ] **Step 5: Commit**

```bash
git add sidecar/pyproject.toml sidecar/uv.lock docs/superpowers/specs/2026-06-19-folder-chat-embedding-design.md
git commit -m "chore(embed): torch pyproject 선언 + 구현 결과 문서화"
```

---

## Self-Review (작성자 점검 완료)

**Spec coverage:** §2 결정(모델/런타임/device/청킹/스토어/검색/융합/인가) → Task 1~11 매핑 확인. §4 컴포넌트 8개 → Task 1·3·4(sidecar), 5·6·7·8·9·10·11(Rails) 전부 커버. §6 인가 → Task 9·10 인가 테스트. §7 에러처리 → Task 10 fallback 테스트. §8 모델버전 → Task 8 구버전 재처리 테스트. §11 Phase 0 → 완료. §10 테스트 → 각 태스크 TDD.

**Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드. 테스트 코드 실재.

**Type consistency:** `embed(texts)->embeddings array`(Task 6) ↔ Job/Search 사용 일치. `TranscriptVectorSearch.search(query_text:, meeting_ids:, limit:)->[{transcript_id:,score:}]`(Task 9) ↔ FolderChatContext `vector_ranked_ids`(Task 10) 일치. `MODEL_VERSION="kure-v1"`(Task 5) ↔ Job·Search·Backfill 일치. `KureEncoder.encode/model_version/dim`(Task 3) ↔ 라우터(Task 4) 일치. `EmbedResponse{embeddings,model,dim}`(Task 1) ↔ 라우터·SidecarClient 일치.

**미해결(구현 중 자동결정 → 문서화):** numo `sort_index` 동작은 Task 9 테스트로 검증(가정 틀리면 `.max_index` 반복 또는 정렬 대체). 라이브 STT 고볼륨 잡 coalesce는 Phase 3(YAGNI) — 본 플랜 범위 밖.
