"""app.state 접근 의존성 헬퍼.

라우터에서 `request.app`을, lifespan/모듈에서 전역 `app`을 첫 인자로 넘겨
화자 구분 파이프라인·회의별 diarizer·요약기 인스턴스를 가져온다.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from app.config import settings
from app.llm.summarizer import LLMSummarizer
from app.schemas import LlmConfigOverride

logger = logging.getLogger(__name__)


async def ensure_diarizer_pipeline(app: FastAPI):
    """화자 구분 파이프라인을 lazy load한다. 이미 로드됐으면 즉시 반환."""
    if app.state.diarizer_pipeline is not None:
        return app.state.diarizer_pipeline
    if app.state.diarizer_loading:
        return None  # 다른 요청에서 로드 중
    if not settings.HF_TOKEN:
        return None
    app.state.diarizer_loading = True
    try:
        from app.diarization.speaker import SpeakerDiarizer
        _loader = SpeakerDiarizer()
        await _loader.load(hf_token=settings.HF_TOKEN)
        app.state.diarizer_pipeline = _loader.pipeline
        logger.info("화자 구분 모델 lazy load 완료")
        return app.state.diarizer_pipeline
    except Exception as e:
        logger.error("화자 구분 모델 로드 실패: %s", e)
        return None
    finally:
        app.state.diarizer_loading = False


def get_meeting_diarizer(app: FastAPI, meeting_id: int | None, diarization_config: dict | None = None):
    """회의별 SpeakerDiarizer를 가져온다 (없으면 생성)."""
    from app.diarization.speaker import make_meeting_diarizer
    pipeline = getattr(app.state, "diarizer_pipeline", None)
    if pipeline is None or meeting_id is None:
        return None
    # 프론트엔드에서 화자분리 비활성화 요청
    if diarization_config and not diarization_config.get("enable", True):
        return None
    diarizers: dict = app.state.meeting_diarizers
    if meeting_id not in diarizers:
        kwargs = {}
        if diarization_config:
            kwargs = {k: v for k, v in diarization_config.items()
                      if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        diarizers[meeting_id] = make_meeting_diarizer(meeting_id, pipeline, **kwargs)
    elif diarization_config:
        config_kwargs = {k: v for k, v in diarization_config.items()
                         if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        if config_kwargs:
            diarizers[meeting_id].update_config(**config_kwargs)
    return diarizers[meeting_id]


def get_summarizer(app: FastAPI, llm_config: LlmConfigOverride | None) -> LLMSummarizer:
    """llm_config가 있으면 임시 LLMSummarizer를 생성하고, 없으면 기본 인스턴스를 반환한다."""
    if llm_config is None:
        return app.state.summarizer
    override = settings.model_copy()
    override.LLM_PROVIDER = llm_config.provider
    override.LLM_MODEL = llm_config.model
    if llm_config.provider == "openai":
        override.OPENAI_API_KEY = llm_config.auth_token
        override.OPENAI_BASE_URL = llm_config.base_url or ""
    else:
        override.ANTHROPIC_AUTH_TOKEN = llm_config.auth_token
        override.ANTHROPIC_BASE_URL = llm_config.base_url or ""
    return LLMSummarizer(settings_override=override)
