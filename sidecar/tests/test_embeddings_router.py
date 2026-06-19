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
