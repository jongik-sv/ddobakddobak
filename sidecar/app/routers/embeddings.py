"""임베딩 라우터 — folder-chat 의미검색용 KURE-v1 임베딩."""
import logging

from fastapi import APIRouter, Request

from app.schemas import EmbedRequest, EmbedResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest, http_request: Request) -> EmbedResponse:
    encoder = http_request.app.state.embedder
    if not request.texts:
        return EmbedResponse(embeddings=[], model=encoder.model_version, dim=encoder.dim or 0)
    # GPU/모델 동시 접근 직렬화 (STT Metal 충돌·스레드 안전)
    lock = http_request.app.state.embed_lock
    async with lock:
        vectors = encoder.encode(request.texts)
    return EmbedResponse(embeddings=vectors, model=encoder.model_version, dim=encoder.dim or len(vectors[0]))
