"""KureEncoder 유휴 오프로드 동작 테스트.

실제 KURE 가중치·torch 없이, _load_raw를 가짜 모델로 몽키패치해 상태 전이만 검증한다.
"""
import pytest

from app.embeddings.encoder import KureEncoder


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
