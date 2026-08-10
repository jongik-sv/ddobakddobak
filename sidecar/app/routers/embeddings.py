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
        # 모델을 깨우지 않는다 — 유휴 언로드 상태를 유지한다.
        return EmbedResponse(embeddings=[], model=encoder.model_version, dim=encoder.dim or 0)
    # 동시 호출 직렬화·GPU 복귀·유휴 시각 갱신은 인코더의 IdleOffloadController가 담당한다.
    vectors = await encoder.encode_async(request.texts)
    return EmbedResponse(embeddings=vectors, model=encoder.model_version, dim=encoder.dim or len(vectors[0]))
