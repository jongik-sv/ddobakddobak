"""회의별 화자 관리 라우터."""
import urllib.parse

from fastapi import APIRouter, HTTPException, Request

from app.deps import get_meeting_diarizer
from app.schemas import RenameSpeakerRequest

router = APIRouter()


@router.get("/speakers")
async def get_speakers(meeting_id: int, request: Request) -> dict:
    """회의별 등록된 화자 목록을 반환한다."""
    diarizer = get_meeting_diarizer(request.app, meeting_id)
    if diarizer is None:
        return {"speakers": []}
    return {"speakers": diarizer.get_speakers()}


@router.put("/speakers/{speaker_id}")
async def rename_speaker(speaker_id: str, meeting_id: int, request: RenameSpeakerRequest, http_request: Request) -> dict:
    """화자에 이름을 부여한다."""
    decoded_id = urllib.parse.unquote(speaker_id)
    diarizer = get_meeting_diarizer(http_request.app, meeting_id)
    if diarizer is None:
        raise HTTPException(status_code=503, detail="화자 구분 모델이 비활성화 상태입니다.")
    if not diarizer.rename_speaker(decoded_id, request.name):
        raise HTTPException(status_code=404, detail=f"화자 '{decoded_id}'를 찾을 수 없습니다.")
    return {"id": decoded_id, "name": request.name}


@router.delete("/speakers")
async def reset_speakers(meeting_id: int, request: Request) -> dict:
    """회의의 화자 DB를 초기화한다."""
    diarizer = get_meeting_diarizer(request.app, meeting_id)
    if diarizer is not None:
        diarizer.reset_db()
        # 메모리에서도 제거
        request.app.state.meeting_diarizers.pop(meeting_id, None)
    return {"ok": True}
