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
