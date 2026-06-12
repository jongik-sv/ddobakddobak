"""회의별 화자 관리 라우터 — SpeakerDB JSON 파일 직접 접근 (pipeline 불필요).

sidecar 재시작 후나 배치 전용 흐름에서도 화자 목록 조회/이름 변경/초기화가
동작하도록 SpeakerDB 파일을 직접 읽고 쓴다.
"""
import urllib.parse

from fastapi import APIRouter, HTTPException

from app.schemas import RenameSpeakerRequest

router = APIRouter()


def _open_db(meeting_id: int):
    from app.diarization.speaker import _get_db_dir
    from app.diarization.speaker_db import SpeakerDB

    db = SpeakerDB(_get_db_dir() / f"meeting_{meeting_id}.json")
    db.load()
    return db


@router.get("/speakers")
async def get_speakers(meeting_id: int) -> dict:
    """회의별 등록된 화자 목록을 반환한다."""
    db = _open_db(meeting_id)
    return {"speakers": [
        {"id": label, "name": db.names.get(label, label)}
        for label in db.embeddings
    ]}


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
