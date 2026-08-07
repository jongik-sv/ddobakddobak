"""/speakers 라우터 — pipeline 없이 SpeakerDB 파일만으로 동작 검증."""
import base64
import json

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _enc(vals: list[float]) -> str:
    """실제 화자 임베딩과 동일한 방식(float32 → base64)으로 인코딩한다."""
    return base64.b64encode(np.array(vals, dtype=np.float32).tobytes()).decode()


@pytest.fixture
def speaker_db(tmp_path, monkeypatch):
    # _get_db_dir()는 호출 시점에 app.config.settings.SPEAKER_DBS_DIR를 읽는다
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))
    db_file = tmp_path / "meeting_42.json"
    db_file.write_text(json.dumps({
        "next_num": 3,
        "speakers": {"화자 1": [], "화자 2": []},
        "names": {"화자 1": "김철수"},
    }, ensure_ascii=False))
    return db_file


async def test_get_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    speakers = {s["id"]: s["name"] for s in res.json()["speakers"]}
    assert speakers == {"화자 1": "김철수", "화자 2": "화자 2"}


async def test_rename_speaker_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                               json={"name": "이영희"})
    assert res.status_code == 200
    assert res.json() == {"id": "화자 2", "name": "이영희"}
    data = json.loads(speaker_db.read_text())
    assert data["names"]["화자 2"] == "이영희"


async def test_rename_unknown_speaker_returns_404(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/없는화자", params={"meeting_id": 42},
                               json={"name": "X"})
    assert res.status_code == 404


async def test_reset_speakers_without_pipeline(speaker_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete("/speakers", params={"meeting_id": 42})
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert not speaker_db.exists()


# ---------------------------------------------------------------------------
# GET/PUT /speakers/db — export/import를 위한 SpeakerDB 전체(임베딩 포함) 왕복
# ---------------------------------------------------------------------------

@pytest.fixture
def speaker_db_with_embeddings(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))
    db_file = tmp_path / "meeting_42.json"
    payload = {
        "next_num": 3,
        "speakers": {
            "화자 1": [_enc([1.0, 2.0, 3.0]), _enc([4.0, 5.0, 6.0])],
            "화자 2": [_enc([7.0, 8.0, 9.0])],
        },
        "names": {"화자 1": "김철수"},
    }
    db_file.write_text(json.dumps(payload, ensure_ascii=False))
    return db_file, payload


async def test_get_speaker_db_returns_embeddings_verbatim(speaker_db_with_embeddings):
    _, payload = speaker_db_with_embeddings
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/speakers/db", params={"meeting_id": 42})
    assert res.status_code == 200
    assert res.json() == payload


async def test_get_speaker_db_unknown_meeting_returns_empty_payload(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/speakers/db", params={"meeting_id": 9999})
    assert res.status_code == 200
    assert res.json() == {"next_num": 1, "speakers": {}, "names": {}}


async def test_put_then_get_speaker_db_round_trips_byte_equal(tmp_path, monkeypatch):
    """import 시나리오: 새 회의 id(99)에 다른 회의(42)에서 내보낸 payload를 그대로 복원."""
    from app.config import settings
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))
    payload = {
        "next_num": 5,
        "speakers": {
            "화자 1": [_enc([1.5, -2.5, 3.5])],
            "화자 2": [],
        },
        "names": {"화자 1": "박영수"},
    }
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        put_res = await client.put("/speakers/db", params={"meeting_id": 99}, json=payload)
        assert put_res.status_code == 200
        assert put_res.json() == {"ok": True}

        get_res = await client.get("/speakers/db", params={"meeting_id": 99})
    assert get_res.status_code == 200
    assert get_res.json() == payload


@pytest.mark.parametrize("malformed_payload", [
    {"next_num": "not-an-int", "speakers": {"화자 1": []}, "names": {}},
    {"next_num": 1, "speakers": {"화자 1": "not-a-list"}, "names": {}},
    {"next_num": 1, "speakers": {"화자 1": [123]}, "names": {}},
    {"next_num": 1, "speakers": {"화자 1": ["not valid base64!!"]}, "names": {}},
    {"next_num": 1, "speakers": {}, "names": {"화자 1": 123}},
    {"speakers": {}, "names": {}},  # next_num 누락
    # base64로는 유효하지만 디코드 길이가 float32 itemsize(4)의 배수가 아니다.
    # 이게 디스크에 닿으면 다음 load()에서 np.frombuffer가 ValueError를 던지고,
    # load()를 통째로 감싼 except가 회의 전체 로스터를 삼킨다
    # (test_load_wipes_entire_roster_when_one_embedding_has_bad_length 참고).
    {"next_num": 1, "speakers": {"화자 1": [base64.b64encode(b"abc").decode()]}, "names": {}},
    # 빈 문자열 임베딩. base64로도 유효하고(a2b_base64('') → b'') 길이도 4의
    # 배수(0 % 4 == 0)라 기존 검사를 전부 통과해 그대로 디스크에 쓰인다.
    # 로스터 전멸 벡터는 아니지만(np.frombuffer(b'')는 예외 대신 빈 배열을 주고
    # is_valid_embedding이 len==0으로 거른다) 왕복 무결성을 깬다 — PUT한 [""]가
    # 다음 GET에선 []로 조용히 사라진다
    # (test_empty_embedding_silently_vanishes_on_load 참고).
    {"next_num": 1, "speakers": {"화자 1": [""]}, "names": {}},
    # 정상 임베딩과 섞여 있어도 빈 것 하나 때문에 payload 전체가 거부돼야 한다
    {"next_num": 1, "speakers": {"화자 1": [_enc([1.0, 2.0]), ""]}, "names": {}},
])
async def test_put_malformed_body_rejected_and_leaves_file_untouched(
    speaker_db_with_embeddings, malformed_payload
):
    db_file, original_payload = speaker_db_with_embeddings
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/db", params={"meeting_id": 42}, json=malformed_payload)
    assert res.status_code == 422
    assert json.loads(db_file.read_text()) == original_payload


async def test_put_replaces_not_merges_existing_db(speaker_db_with_embeddings):
    """기존 DB에 있던 '화자 2'가 PUT payload에 없으면 결과물에서 사라져야 한다(병합 아님)."""
    db_file, original_payload = speaker_db_with_embeddings
    assert "화자 2" in original_payload["speakers"]  # 사전 조건: 기존 DB에 존재

    replacement = {
        "next_num": 1,
        "speakers": {"화자 9": [_enc([9.9])]},
        "names": {},
    }
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/db", params={"meeting_id": 42}, json=replacement)
    assert res.status_code == 200
    on_disk = json.loads(db_file.read_text())
    assert on_disk == replacement
    assert "화자 1" not in on_disk["speakers"]
    assert "화자 2" not in on_disk["speakers"]


def test_load_wipes_entire_roster_when_one_embedding_has_bad_length(tmp_path):
    """SpeakerDbPayload 검증이 왜 필요한지 못 박는 반증 테스트 — 삭제하지 말 것.

    SpeakerDB.load()는 per-label 루프 '전체'를 단일 except Exception으로 감싸고
    있고, 복원된 상태를 self에 대입하는 것은 루프가 끝난 뒤다. 따라서 임베딩
    '하나'의 디코드 길이가 float32 itemsize(4)의 배수가 아니면 np.frombuffer가
    ValueError를 던지고, 그 라벨만이 아니라 회의 전체 화자 로스터가 조용히
    사라진다. is_valid_embedding(NaN/Inf/제로벡터 필터)은 np.frombuffer '뒤'에
    있으므로 이걸 막지 못한다.

    이 테스트는 검증 추가 전후 모두 통과한다 — 검증은 API 경계에서 이런 파일이
    애초에 디스크에 닿지 못하게 막을 뿐 load()를 고치지 않기 때문이다. 훗날
    load()가 per-label 복구로 강화되면 이 테스트는 삭제가 아니라 갱신할 것.
    """
    from app.diarization.speaker_db import SpeakerDB

    db_path = tmp_path / "meeting_7.json"
    db_path.write_text(json.dumps({
        "next_num": 3,
        "speakers": {
            "화자 1": [_enc([1.0, 2.0, 3.0])],               # 완전히 정상
            "화자 2": [base64.b64encode(b"abc").decode()],   # 3바이트 → 4의 배수 아님
        },
        "names": {"화자 1": "김철수", "화자 2": "이영희"},
    }, ensure_ascii=False), encoding="utf-8")

    db = SpeakerDB(db_path)
    db.load()

    # 멀쩡한 '화자 1'까지 함께 증발한다 — 라벨 하나가 아니라 로스터 '전체' 손실
    assert db.embeddings == {}
    assert db.names == {}
    assert db.next_num == 1


def test_empty_embedding_silently_vanishes_on_load(tmp_path):
    """빈 문자열 임베딩을 API 경계에서 막아야 하는 이유 — 삭제하지 말 것.

    빈 문자열은 로스터 전멸 벡터가 아니다: np.frombuffer(b'', float32)는 예외를
    던지지 않고 빈 배열을 주며 is_valid_embedding이 len==0으로 걸러낸다. 대신
    '왕복 무결성'을 깬다 — 디스크에는 [""]로 남는데 다음 load()에서 조용히
    사라지므로 export한 것과 import한 것이 달라진다. 무의미한 오염이므로 애초에
    디스크에 닿지 못하게 막는 것이 맞다.

    이 테스트는 검증 추가 전후 모두 통과한다 — 검증은 load()를 고치지 않고
    이런 파일이 생기지 못하게 막을 뿐이기 때문이다.
    """
    from app.diarization.speaker_db import SpeakerDB

    db_path = tmp_path / "meeting_8.json"
    db_path.write_text(json.dumps({
        "next_num": 3,
        "speakers": {
            "화자 1": [_enc([1.0, 2.0, 3.0])],  # 정상
            "화자 2": [""],                      # 빈 문자열 — 0바이트로 디코드
        },
        "names": {"화자 1": "김철수", "화자 2": "이영희"},
    }, ensure_ascii=False), encoding="utf-8")

    db = SpeakerDB(db_path)
    db.load()

    # 로스터 전체가 날아가지는 않는다 (bad-length 케이스와 다른 점)
    assert list(db.embeddings) == ["화자 1", "화자 2"]
    # 그러나 '화자 2'의 임베딩은 흔적 없이 증발한다 → 저장한 것 ≠ 되읽은 것
    assert db.embeddings["화자 2"] == []


def _oversized(case: str) -> dict:
    """상한을 딱 1만큼 넘긴 payload를 만든다."""
    from app.schemas import (
        MAX_EMBEDDING_BYTES,
        MAX_EMBEDDINGS_PER_SPEAKER,
        MAX_NAME_CHARS,
        MAX_NAMES,
        MAX_SPEAKERS,
    )
    names: dict[str, str] = {}
    speakers: dict[str, list[str]] = {"화자 1": []}
    if case == "too_many_speakers":
        speakers = {f"화자 {i}": [] for i in range(MAX_SPEAKERS + 1)}
    elif case == "too_many_embeddings_per_speaker":
        speakers = {"화자 1": [_enc([1.0])] * (MAX_EMBEDDINGS_PER_SPEAKER + 1)}
    elif case == "embedding_absurdly_large":
        # 디코드 전 O(1) 길이 게이트가 걸러야 한다 (a2b_base64를 호출조차 하지 않음)
        speakers = {"화자 1": [base64.b64encode(b"\x00" * (MAX_EMBEDDING_BYTES * 16)).decode()]}
    elif case == "too_many_names":
        names = {f"화자 {i}": "김" for i in range(MAX_NAMES + 1)}
    elif case == "name_too_long":
        names = {"화자 1": "김" * (MAX_NAME_CHARS + 1)}
    else:  # embedding_too_large — 4의 배수는 유지해서 크기 때문에 걸리게 한다
        speakers = {"화자 1": [base64.b64encode(b"\x00" * (MAX_EMBEDDING_BYTES + 4)).decode()]}
    return {"next_num": 1, "speakers": speakers, "names": names}


@pytest.mark.parametrize("case", [
    "too_many_speakers",
    "too_many_embeddings_per_speaker",
    "embedding_too_large",
    "embedding_absurdly_large",
    "too_many_names",
    "name_too_long",
])
async def test_put_oversized_payload_rejected_and_leaves_file_untouched(
    speaker_db_with_embeddings, case
):
    """상한 없는 전량 디코드는 비용이 무제한이다 — payload 크기에 상한을 둔다."""
    db_file, original_payload = speaker_db_with_embeddings
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/db", params={"meeting_id": 42}, json=_oversized(case))
    assert res.status_code == 422
    assert json.loads(db_file.read_text()) == original_payload


async def test_put_payload_exactly_at_limits_is_accepted(tmp_path, monkeypatch):
    """상한값 자체는 통과해야 한다 — off-by-one으로 정상 export를 막지 않도록."""
    from app.config import settings
    from app.schemas import (
        MAX_EMBEDDING_BYTES,
        MAX_EMBEDDINGS_PER_SPEAKER,
        MAX_NAME_CHARS,
        MAX_NAMES,
        MAX_SPEAKERS,
    )
    monkeypatch.setattr(settings, "SPEAKER_DBS_DIR", str(tmp_path))

    speakers = {f"화자 {i}": [] for i in range(MAX_SPEAKERS)}
    speakers["화자 0"] = [_enc([1.0])] * MAX_EMBEDDINGS_PER_SPEAKER
    speakers["화자 1"] = [base64.b64encode(b"\x00" * MAX_EMBEDDING_BYTES).decode()]
    # names도 개수·길이 상한 '정확히'까지는 통과해야 한다
    names = {f"화자 {i}": "김" * MAX_NAME_CHARS for i in range(MAX_NAMES)}
    payload = {"next_num": 1, "speakers": speakers, "names": names}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.put("/speakers/db", params={"meeting_id": 77}, json=payload)
    assert res.status_code == 200
    assert json.loads((tmp_path / "meeting_77.json").read_text()) == payload


async def test_rename_enforces_same_name_cap_as_payload(speaker_db):
    """rename의 이름 길이 상한은 payload의 names 상한과 같아야 한다.

    다르면 rename으로 만든 DB를 export한 뒤 다시 import할 수 없게 된다 —
    빈 임베딩과 똑같은 종류의 왕복 무결성 파손이다.
    """
    from app.schemas import MAX_NAME_CHARS

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        ok = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                              json={"name": "김" * MAX_NAME_CHARS})
        too_long = await client.put("/speakers/화자 2", params={"meeting_id": 42},
                                    json={"name": "김" * (MAX_NAME_CHARS + 1)})
    assert ok.status_code == 200
    assert too_long.status_code == 422
    # 거부된 요청은 디스크를 건드리지 않는다 — 직전 성공값이 그대로 남아야 한다
    assert json.loads(speaker_db.read_text())["names"]["화자 2"] == "김" * MAX_NAME_CHARS
