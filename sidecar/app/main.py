"""FastAPI 앱 진입점 — 앱 조립 및 라우터 등록만 담당한다."""
import asyncio
import contextlib
import gc
import logging
from contextlib import asynccontextmanager

import app.bootstrap  # noqa: F401  # 프로세스 시작 설정 — torch import보다 먼저 실행

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi import FastAPI

from app.llm.summarizer import LLMSummarizer
from app.stt.factory import create_stt_adapter

# 유휴 오프로드 백그라운드 루프 점검 주기(초). settings.STT_IDLE_UNLOAD_SEC/STT_IDLE_FULL_UNLOAD_SEC
# 자체는 [재시작 필요] 설정이라 루프 시작 시 1회만 해석한다(다른 [재시작 필요] 설정과 동일한 관례).
_IDLE_OFFLOAD_INTERVAL_SEC = 60.0


async def _idle_offload_loop(app: FastAPI, interval_sec: float = _IDLE_OFFLOAD_INTERVAL_SEC) -> None:
    """주기적으로 STT 어댑터의 유휴 시간을 점검해 GPU 오프로드를 수행한다."""
    from app.config import settings
    from app.stt.idle_offload import resolve_idle_thresholds

    idle_unload_sec, idle_full_unload_sec = resolve_idle_thresholds(
        settings.STT_IDLE_UNLOAD_SEC, settings.STT_IDLE_FULL_UNLOAD_SEC
    )
    if idle_unload_sec <= 0:
        logger.info("[idle-offload] STT_IDLE_UNLOAD_SEC=0 — GPU 유휴 오프로드 비활성화")
        return

    logger.info(
        "[idle-offload] 활성화 (idle_unload_sec=%.0f, idle_full_unload_sec=%.0f, 점검주기=%.0fs)",
        idle_unload_sec, idle_full_unload_sec, interval_sec,
    )
    while True:
        await asyncio.sleep(interval_sec)
        adapter = getattr(app.state, "stt_adapter", None)
        if adapter is None:
            continue
        try:
            await adapter.maybe_offload(idle_unload_sec, idle_full_unload_sec)
        except Exception:
            logger.exception("[idle-offload] 오프로드 점검 실패 (다음 주기에 재시도)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 STT 모델을 로드하고, 종료 시 정리한다."""
    app.state.stt_adapter = create_stt_adapter()
    await app.state.stt_adapter.load_model()
    app.state.summarizer = LLMSummarizer()
    app.state.engine_lock = asyncio.Lock()
    app.state.gpu_lock = asyncio.Lock()  # Metal GPU 동시 접근 방지
    app.state.refine_locks = {}  # 회의별 LLM 동시 호출 방지 (값=락+waiter 카운트 entry, llm.refine_notes가 관리·정리)
    from app.embeddings.encoder import KureEncoder
    from app.config import settings as _settings
    app.state.embedder = KureEncoder(_settings.EMBED_MODEL, _settings.EMBED_MODEL_VERSION, _settings.EMBED_DEVICE)
    app.state.embed_lock = asyncio.Lock()
    app.state.idle_offload_task = asyncio.create_task(_idle_offload_loop(app))

    yield

    # 종료 시 리소스 명시적 해제 (세마포어 누수 방지)
    idle_task = getattr(app.state, "idle_offload_task", None)
    if idle_task is not None:
        idle_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await idle_task
    app.state.stt_adapter = None
    gc.collect()


app = FastAPI(
    title="ddobakddobak sidecar",
    description="STT / 화자 분리 / AI 요약 Python Sidecar 서비스",
    version="0.1.0",
    lifespan=lifespan,
)

from app.routers import embeddings, health, llm, settings as settings_router, speakers, stt

app.include_router(health.router)
app.include_router(speakers.router)
app.include_router(settings_router.router)
app.include_router(llm.router)
app.include_router(stt.router)
app.include_router(embeddings.router)
