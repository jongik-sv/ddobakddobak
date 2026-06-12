"""app.state 접근 의존성 헬퍼.

라우터에서 `request.app`을, lifespan/모듈에서 전역 `app`을 첫 인자로 넘겨
요약기 인스턴스를 가져온다.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from app.config import settings
from app.llm.summarizer import LLMSummarizer
from app.schemas import LlmConfigOverride

logger = logging.getLogger(__name__)


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
