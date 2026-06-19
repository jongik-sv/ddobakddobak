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
