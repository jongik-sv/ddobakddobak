"""SpeakerDiarizer 매칭 알고리즘 characterization 테스트.

상태 저장소(SpeakerDB) 리팩토링 전후 동작 보존을 보장한다.
파이프라인 없이 내부 매칭 메서드를 직접 호출한다.
"""
import numpy as np

from app.diarization.speaker import SpeakerDiarizer


def _unit(*vals) -> np.ndarray:
    v = np.array(vals, dtype=np.float32)
    return v / np.linalg.norm(v)


def test_match_or_create_first_speaker():
    d = SpeakerDiarizer()
    sid = d._match_or_create(_unit(1, 0, 0))
    assert sid == "화자 1"
    assert d._db.next_num == 2
    assert "화자 1" in d._db.embeddings


def test_match_or_create_matches_similar():
    d = SpeakerDiarizer()
    d._match_or_create(_unit(1, 0, 0))
    sid = d._match_or_create(_unit(0.99, 0.01, 0))  # 거의 동일 → 매칭
    assert sid == "화자 1"
    assert len(d._db.embeddings) == 1


def test_match_or_create_creates_new_for_dissimilar():
    d = SpeakerDiarizer()
    d._match_or_create(_unit(1, 0, 0))
    sid = d._match_or_create(_unit(0, 1, 0))  # 직교 → 새 화자
    assert sid == "화자 2"
    assert set(d._db.embeddings.keys()) == {"화자 1", "화자 2"}


def test_fallback_speaker_empty_creates_new():
    d = SpeakerDiarizer()
    assert d._fallback_speaker() == "화자 1"
    assert d._db.next_num == 2


def test_fallback_speaker_returns_last_existing():
    d = SpeakerDiarizer()
    d._match_or_create(_unit(1, 0, 0))
    d._match_or_create(_unit(0, 1, 0))
    assert d._fallback_speaker() == "화자 2"


def test_get_speakers_and_rename():
    d = SpeakerDiarizer()
    d._match_or_create(_unit(1, 0, 0))
    assert d.get_speakers() == [{"id": "화자 1", "name": "화자 1"}]
    assert d.rename_speaker("화자 1", "김개발") is True
    assert d.get_speakers() == [{"id": "화자 1", "name": "김개발"}]
    assert d.rename_speaker("없는화자", "X") is False


def test_reset_db_clears_state():
    d = SpeakerDiarizer()
    d._match_or_create(_unit(1, 0, 0))
    d._match_or_create(_unit(0, 1, 0))
    d.reset_db()
    assert d._db.embeddings == {}
    assert d._db.names == {}
    assert d._db.next_num == 1


def test_merge_similar_speakers():
    d = SpeakerDiarizer()
    # 거의 동일한 두 화자를 강제로 만든 뒤 병합
    d._db.embeddings = {"화자 1": [_unit(1, 0, 0)], "화자 2": [_unit(0.99, 0.01, 0)]}
    d._db.next_num = 3
    d._merge_similar_speakers()
    assert len(d._db.embeddings) == 1
    assert "화자 1" in d._db.embeddings
