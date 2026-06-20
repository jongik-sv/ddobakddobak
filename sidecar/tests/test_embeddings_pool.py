import torch
import types
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
