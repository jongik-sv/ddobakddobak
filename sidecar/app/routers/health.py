"""헬스체크 및 STT 엔진 설정 라우터."""
import asyncio
import gc
import logging

from fastapi import APIRouter, HTTPException, Request

from app.config import settings
from app.engines import AVAILABLE_STT_ENGINES
from app.env_utils import _persist_env
from app.schemas import HealthResponse, UpdateSttEngineRequest
from app.stt.factory import auto_select_engine, create_stt_adapter

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/warmup")
async def warmup(request: Request) -> dict:
    """예약 회의 1분 전 호출. 2초 무음으로 STT 어댑터를 1회 추론해
    커널 컴파일(MLX/CUDA lazy eval)을 끝내고 모델 로드를 보장한다."""
    adapter = getattr(request.app.state, "stt_adapter", None)
    silence = b"\x00" * 64000  # 2s @ 16kHz int16 mono
    try:
        await adapter.transcribe(silence)
    except Exception as e:  # noqa: BLE001
        logger.warning("[warmup] 추론 실패(무시): %s", e)
    return {"warmed": True}


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """헬스체크 엔드포인트.

    Returns:
        status: 서버 상태 ("ok")
        stt_engine: 현재 설정된 STT 엔진 이름
        model_loaded: STT 모델 로드 여부
    """
    adapter = getattr(request.app.state, "stt_adapter", None)
    resolved_engine = (
        auto_select_engine() if settings.STT_ENGINE == "auto" else settings.STT_ENGINE
    )
    return HealthResponse(
        status="ok",
        stt_engine=resolved_engine,
        model_loaded=adapter.is_loaded if adapter is not None else False,
        gpu_resident=adapter.gpu_resident if adapter is not None else False,
        model_state=adapter.resident_state if adapter is not None else "unloaded",
    )


@router.get("/settings/stt-engine")
async def get_stt_engine(request: Request) -> dict:
    """현재 STT 엔진 설정과 사용 가능한 엔진 목록을 반환한다.

    settings.STT_ENGINE이 "auto"면 실제 플랫폼에서 선택될 구체 엔진명으로
    해석해 반환한다 (프론트 라디오가 "auto" 값을 모르기 때문).
    """
    adapter = getattr(request.app.state, "stt_adapter", None)
    resolved_engine = (
        auto_select_engine() if settings.STT_ENGINE == "auto" else settings.STT_ENGINE
    )
    return {
        "current": resolved_engine,
        "available": AVAILABLE_STT_ENGINES,
        "model_loaded": adapter.is_loaded if adapter is not None else False,
    }


@router.put("/settings/stt-engine")
async def update_stt_engine(request: UpdateSttEngineRequest, http_request: Request) -> HealthResponse:
    """STT 엔진을 런타임에 변경한다."""
    if request.engine not in AVAILABLE_STT_ENGINES:
        raise HTTPException(
            status_code=422,
            detail=f"'{request.engine}' 엔진을 사용할 수 없습니다. 사용 가능한 엔진: {AVAILABLE_STT_ENGINES}"
        )
    # 동시에 여러 번 전환 요청이 와도 하나씩 처리
    lock: asyncio.Lock = http_request.app.state.engine_lock
    if lock.locked():
        raise HTTPException(status_code=409, detail="모델 변경이 이미 진행 중입니다. 잠시 후 다시 시도하세요.")
    async with lock:
        # 같은 엔진이면 스킵
        if settings.STT_ENGINE == request.engine:
            adapter = http_request.app.state.stt_adapter
            return HealthResponse(
                status="ok",
                stt_engine=settings.STT_ENGINE,
                model_loaded=adapter.is_loaded,
                gpu_resident=adapter.gpu_resident,
                model_state=adapter.resident_state,
            )
        # 이전 모델을 먼저 해제하여 Metal GPU 컨텍스트 충돌 방지
        # (pywhispercpp + mlx-audio 동시 Metal 사용 시 크래시 발생)
        old_adapter = http_request.app.state.stt_adapter
        http_request.app.state.stt_adapter = None  # type: ignore[assignment]
        del old_adapter
        gc.collect()  # 즉시 GC로 Metal 리소스 해제 보장

        try:
            new_adapter = create_stt_adapter(request.engine)
            await new_adapter.load_model()
        except (ImportError, NotImplementedError) as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"모델 로드 실패: {e}") from e
        http_request.app.state.stt_adapter = new_adapter
        settings.STT_ENGINE = request.engine
        _persist_env(STT_ENGINE=settings.STT_ENGINE)
        return HealthResponse(
            status="ok",
            stt_engine=settings.STT_ENGINE,
            model_loaded=new_adapter.is_loaded,
            gpu_resident=new_adapter.gpu_resident,
            model_state=new_adapter.resident_state,
        )
