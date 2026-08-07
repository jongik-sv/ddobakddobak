"""회의별 화자 관리 라우터 — SpeakerDB JSON 파일 직접 접근 (pipeline 불필요).

sidecar 재시작 후나 배치 전용 흐름에서도 화자 목록 조회/이름 변경/초기화가
동작하도록 SpeakerDB 파일을 직접 읽고 쓴다.
"""
import base64
import json
import os
import tempfile
import urllib.parse
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas import RenameSpeakerRequest, SpeakerDbPayload

router = APIRouter()


def _atomic_write_json(path: Path, data: dict) -> None:
    """임시 파일에 쓴 뒤 rename — 실패 시 기존 파일이 손상되지 않도록 한다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _open_db(meeting_id: int):
    from app.diarization.speaker import _get_db_dir
    from app.diarization.speaker_db import SpeakerDB

    db = SpeakerDB(_get_db_dir() / f"meeting_{meeting_id}.json")
    db.load()
    return db


def _encode_db(db) -> dict:
    """SpeakerDB(메모리) 상태를 export/import용 JSON payload로 인코딩한다."""
    speakers = {
        label: [
            base64.b64encode(emb.astype("float32").tobytes()).decode()
            for emb in emb_list
        ]
        for label, emb_list in db.embeddings.items()
    }
    return {"next_num": db.next_num, "speakers": speakers, "names": db.names}


@router.get("/speakers")
async def get_speakers(meeting_id: int) -> dict:
    """회의별 등록된 화자 목록을 반환한다."""
    db = _open_db(meeting_id)
    return {"speakers": [
        {"id": label, "name": db.names.get(label, label)}
        for label in db.embeddings
    ]}


@router.get("/speakers/db")
async def get_speaker_db(meeting_id: int) -> dict:
    """회의의 SpeakerDB 전체(임베딩 포함)를 반환한다.

    export를 위해 Rails가 호출한다. 파일이 없는 회의(미분리 회의 등)는
    404가 아니라 SpeakerDB의 기본 상태(빈 payload)를 반환한다.
    """
    db = _open_db(meeting_id)
    return _encode_db(db)


@router.put("/speakers/db")
async def replace_speaker_db(meeting_id: int, payload: SpeakerDbPayload) -> dict:
    """회의의 SpeakerDB 전체를 payload로 통째로 교체한다 (병합 아님).

    import를 위해 Rails가 호출한다: 새 meeting_id로 내보낸 SpeakerDB(임베딩
    포함)를 그대로 복원한다. 이 라우트는 `/speakers/{speaker_id}`보다 먼저
    등록되어 있어야 한다 — 그렇지 않으면 speaker_id="db"로 잘못 매칭된다.
    """
    from app.diarization.speaker import _get_db_dir

    path = _get_db_dir() / f"meeting_{meeting_id}.json"
    _atomic_write_json(path, payload.model_dump())
    return {"ok": True}


@router.put("/speakers/{speaker_id}")
async def rename_speaker(speaker_id: str, meeting_id: int, request: RenameSpeakerRequest) -> dict:
    """화자에 이름을 부여한다."""
    decoded_id = urllib.parse.unquote(speaker_id)
    db = _open_db(meeting_id)
    if decoded_id not in db.embeddings:
        raise HTTPException(status_code=404, detail=f"화자 '{decoded_id}'를 찾을 수 없습니다.")
    db.names[decoded_id] = request.name
    db.save()
    return {"id": decoded_id, "name": request.name}


@router.delete("/speakers")
async def reset_speakers(meeting_id: int) -> dict:
    """회의의 화자 DB를 초기화한다 (저장 파일 삭제)."""
    db = _open_db(meeting_id)
    db.reset()
    return {"ok": True}
