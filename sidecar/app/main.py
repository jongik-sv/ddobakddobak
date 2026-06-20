"""FastAPI 앱 진입점 — 앱 조립 및 라우터 등록만 담당한다."""
import asyncio
import gc
import logging
from contextlib import asynccontextmanager

import app.bootstrap  # noqa: F401  # 프로세스 시작 설정 — torch import보다 먼저 실행

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi import FastAPI

from app.llm.summarizer import LLMSummarizer
from app.stt.factory import create_stt_adapter


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

    yield

    # 종료 시 리소스 명시적 해제 (세마포어 누수 방지)
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
