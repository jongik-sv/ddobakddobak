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


import pytest
from fastapi.testclient import TestClient


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
    # lifespan 없이 생성 — 실제 KURE/STT 모델 로드를 우회하고 스텁만 주입한다.
    from app.main import app
    c = TestClient(app)
    c.app.state.embedder = _StubEncoder()  # 실제 KURE 로드 우회
    return c


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
