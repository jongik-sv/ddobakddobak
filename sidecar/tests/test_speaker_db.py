"""SpeakerDB 영속화 characterization 테스트 — 분리 전후 동작 보존 보장."""
import numpy as np

from app.diarization.speaker_db import SpeakerDB, is_valid_embedding


def test_is_valid_embedding():
    assert is_valid_embedding(np.array([1.0, 0.0, 0.0], dtype=np.float32))
    assert not is_valid_embedding(np.array([np.nan, 1.0], dtype=np.float32))
    assert not is_valid_embedding(np.array([np.inf, 1.0], dtype=np.float32))
    assert not is_valid_embedding(np.zeros(3, dtype=np.float32))
    assert not is_valid_embedding(None)


def test_save_load_roundtrip(tmp_path):
    path = tmp_path / "meeting_1.json"
    db = SpeakerDB(path)
    embeddings = {
        "화자 1": [np.array([1.0, 0.0, 0.0], dtype=np.float32)],
        "화자 2": [np.array([0.0, 1.0, 0.0], dtype=np.float32), np.array([0.0, 0.9, 0.1], dtype=np.float32)],
    }
    names = {"화자 1": "김개발"}
    db.save(3, names, embeddings)

    loaded = SpeakerDB(path).load()
    assert loaded is not None
    next_num, loaded_names, loaded_emb = loaded
    assert next_num == 3
    assert loaded_names == {"화자 1": "김개발"}
    assert set(loaded_emb.keys()) == {"화자 1", "화자 2"}
    assert len(loaded_emb["화자 2"]) == 2
    assert np.allclose(loaded_emb["화자 1"][0], [1.0, 0.0, 0.0])


def test_load_missing_returns_none(tmp_path):
    assert SpeakerDB(tmp_path / "nope.json").load() is None


def test_load_drops_names_without_embeddings(tmp_path):
    path = tmp_path / "m.json"
    db = SpeakerDB(path)
    # 이름은 있으나 임베딩 없는 화자는 로드 시 제거됨
    db.save(2, {"화자 1": "A", "화자 9": "유령"}, {"화자 1": [np.array([1.0, 0.0], dtype=np.float32)]})
    _, names, emb = SpeakerDB(path).load()
    assert "화자 9" not in names
    assert "화자 1" in names


def test_delete(tmp_path):
    path = tmp_path / "m.json"
    db = SpeakerDB(path)
    db.save(1, {}, {"화자 1": [np.array([1.0, 0.0], dtype=np.float32)]})
    assert path.exists()
    db.delete()
    assert not path.exists()
