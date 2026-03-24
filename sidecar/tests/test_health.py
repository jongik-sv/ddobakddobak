"""Tests for GET /health endpoint."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_response_has_required_fields(client):
    response = client.get("/health")
    data = response.json()
    assert "status" in data
    assert "stt_engine" in data
    assert "model_loaded" in data


def test_health_status_is_ok(client):
    response = client.get("/health")
    data = response.json()
    assert data["status"] == "ok"


def test_health_model_loaded_is_bool(client):
    response = client.get("/health")
    data = response.json()
    assert isinstance(data["model_loaded"], bool)


def test_health_stt_engine_is_string(client):
    response = client.get("/health")
    data = response.json()
    assert isinstance(data["stt_engine"], str)
    assert len(data["stt_engine"]) > 0
