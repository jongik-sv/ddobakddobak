"""
E2E 테스트용 Python Sidecar stub 서버

실제 STT/LLM 없이 고정 응답을 반환한다.
FastAPI로 구현되며 웹소켓(/ws/transcribe) 및 HTTP(/summarize) 엔드포인트를 제공한다.

실행: uvicorn sidecar_stub:app --port 8001
"""

import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

app = FastAPI(title="E2E Sidecar Stub")


@app.get("/health")
async def health():
    return {"status": "ok", "mode": "stub"}


@app.websocket("/ws/transcribe")
async def mock_transcribe(websocket: WebSocket):
    """
    STT WebSocket stub: 수신된 오디오 청크마다 고정 STT 결과를 반환한다.
    """
    await websocket.accept()
    chunk_count = 0
    try:
        async for data in websocket.iter_bytes():
            chunk_count += 1
            # 3청크마다 partial 결과, 6청크마다 final 결과 반환
            if chunk_count % 6 == 0:
                await websocket.send_json({
                    "type": "final",
                    "speaker_label": "화자1",
                    "content": "E2E 테스트 고정 텍스트입니다.",
                    "started_at_ms": (chunk_count - 6) * 500,
                    "ended_at_ms": chunk_count * 500,
                    "sequence_number": chunk_count // 6,
                })
            elif chunk_count % 3 == 0:
                await websocket.send_json({
                    "type": "partial",
                    "speaker_label": "화자1",
                    "content": "E2E 테스트 고정...",
                    "started_at_ms": (chunk_count - 3) * 500,
                })
    except WebSocketDisconnect:
        pass


@app.post("/summarize")
async def mock_summarize():
    """
    LLM 요약 stub: 고정 요약 데이터를 반환한다.
    """
    return {
        "key_points": [
            "E2E 테스트 핵심 요약 첫 번째 항목",
            "E2E 테스트 핵심 요약 두 번째 항목",
        ],
        "decisions": [
            "E2E 테스트 결정사항",
        ],
        "action_items": [
            {
                "content": "E2E 테스트 할일 항목",
                "assignee": None,
                "due_date": None,
            }
        ],
        "discussion_details": [
            "E2E 테스트 논의 상세 내용",
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
