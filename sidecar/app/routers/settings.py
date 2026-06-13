"""LLM / HuggingFace 설정 라우터."""
import time

from fastapi import APIRouter, HTTPException, Request

from app.config import CLI_LLM_PROVIDERS, settings
from app.deps import get_summarizer
from app.env_utils import _mask_token, _persist_env
from app.llm.summarizer import LLMSummarizer
from app.schemas import (
    LlmConfigOverride,
    TestLlmRequest,
    UpdateHfSettingsRequest,
    UpdateLlmSettingsRequest,
    UpdateSttFileEngineRequest,
)
from app.stt.factory import available_file_engines

router = APIRouter()


def _llm_token_and_url(provider: str) -> tuple[str, str]:
    """프로바이더에 따른 마스킹된 토큰과 base_url을 반환한다."""
    if provider in CLI_LLM_PROVIDERS:
        return "", ""
    if provider == "openai":
        return _mask_token(settings.OPENAI_API_KEY), settings.OPENAI_BASE_URL
    return _mask_token(settings.ANTHROPIC_AUTH_TOKEN), settings.ANTHROPIC_BASE_URL


@router.get("/settings/llm")
async def get_llm_settings() -> dict:
    """현재 LLM 설정을 반환한다."""
    provider = settings.LLM_PROVIDER
    token_masked, base_url = _llm_token_and_url(provider)
    return {
        "provider": provider,
        "auth_token_masked": token_masked,
        "anthropic_token_masked": _mask_token(settings.ANTHROPIC_AUTH_TOKEN),
        "openai_token_masked": _mask_token(settings.OPENAI_API_KEY),
        "base_url": base_url,
        "model": settings.LLM_MODEL,
        "max_input_tokens": settings.LLM_MAX_INPUT_TOKENS,
        "max_output_tokens": settings.LLM_MAX_OUTPUT_TOKENS,
    }


@router.put("/settings/llm")
async def update_llm_settings(request: UpdateLlmSettingsRequest, http_request: Request) -> dict:
    """LLM 설정을 런타임에 변경하고 클라이언트를 재생성한다."""
    if request.provider is not None:
        settings.LLM_PROVIDER = request.provider
    if request.auth_token is not None and settings.LLM_PROVIDER not in CLI_LLM_PROVIDERS:
        if settings.LLM_PROVIDER == "openai":
            settings.OPENAI_API_KEY = request.auth_token
        else:
            settings.ANTHROPIC_AUTH_TOKEN = request.auth_token
    if request.base_url is not None and settings.LLM_PROVIDER not in CLI_LLM_PROVIDERS:
        if settings.LLM_PROVIDER == "openai":
            settings.OPENAI_BASE_URL = request.base_url
        else:
            settings.ANTHROPIC_BASE_URL = request.base_url
    if request.model is not None:
        settings.LLM_MODEL = request.model
    if request.max_input_tokens is not None:
        settings.LLM_MAX_INPUT_TOKENS = request.max_input_tokens
    if request.max_output_tokens is not None:
        settings.LLM_MAX_OUTPUT_TOKENS = request.max_output_tokens

    # LLM 클라이언트 재생성
    http_request.app.state.summarizer = LLMSummarizer()

    # .env 파일에 영구 저장
    env_updates: dict[str, str] = {
        "LLM_PROVIDER": settings.LLM_PROVIDER,
        "LLM_MODEL": settings.LLM_MODEL,
        "LLM_MAX_INPUT_TOKENS": str(settings.LLM_MAX_INPUT_TOKENS),
        "LLM_MAX_OUTPUT_TOKENS": str(settings.LLM_MAX_OUTPUT_TOKENS),
    }
    if settings.LLM_PROVIDER == "openai":
        if request.auth_token is not None:
            env_updates["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
        env_updates["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL
    elif settings.LLM_PROVIDER not in CLI_LLM_PROVIDERS:
        if request.auth_token is not None:
            env_updates["ANTHROPIC_AUTH_TOKEN"] = settings.ANTHROPIC_AUTH_TOKEN
        env_updates["ANTHROPIC_BASE_URL"] = settings.ANTHROPIC_BASE_URL
    _persist_env(**env_updates)

    provider = settings.LLM_PROVIDER
    token_masked, base_url = _llm_token_and_url(provider)
    return {
        "provider": provider,
        "auth_token_masked": token_masked,
        "base_url": base_url,
        "model": settings.LLM_MODEL,
        "max_input_tokens": settings.LLM_MAX_INPUT_TOKENS,
        "max_output_tokens": settings.LLM_MAX_OUTPUT_TOKENS,
    }


@router.post("/settings/llm/test")
async def test_llm_connection(request: TestLlmRequest, http_request: Request) -> dict:
    """LLM 연결을 테스트한다. 격리된 설정 복사본을 사용하여 글로벌 상태를 변경하지 않는다."""
    try:
        override = LlmConfigOverride(
            provider=request.provider,
            auth_token=request.auth_token or "",
            model=request.model,
            base_url=request.base_url,
        )
        test_summarizer = get_summarizer(http_request.app, override)
        t0 = time.monotonic()
        await test_summarizer._call_llm_raw("You are a test.", "Hi", max_tokens=5)
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"success": True, "response_time_ms": elapsed_ms}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/settings/hf")
async def get_hf_settings() -> dict:
    """현재 HuggingFace 설정을 반환한다."""
    return {
        "hf_token_masked": _mask_token(settings.HF_TOKEN),
        "has_token": bool(settings.HF_TOKEN),
    }


@router.put("/settings/hf")
async def update_hf_settings(request: UpdateHfSettingsRequest, http_request: Request) -> dict:
    """HuggingFace 토큰을 런타임에 변경한다."""
    settings.HF_TOKEN = request.hf_token

    _persist_env(HF_TOKEN=settings.HF_TOKEN)

    return {
        "hf_token_masked": _mask_token(settings.HF_TOKEN),
        "has_token": bool(settings.HF_TOKEN),
    }


@router.get("/settings/stt-file-engine")
async def get_stt_file_engine() -> dict:
    """현재 배치(파일 재전사) STT 엔진과 플랫폼별 선택 가능 목록을 반환한다."""
    return {
        "file_engine": settings.STT_FILE_ENGINE,
        "available": available_file_engines(),
    }


@router.put("/settings/stt-file-engine")
async def update_stt_file_engine(request: UpdateSttFileEngineRequest) -> dict:
    """배치 STT 엔진을 런타임(in-memory)에 변경한다.

    yaml에는 쓰지 않는다(rails가 별도로 영속화). 모델을 미리 로드하지 않으며,
    다음 transcribe-file 요청에서 resolve_file_engine()이 반영한다.
    """
    available = available_file_engines()
    if request.file_engine not in available:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid file_engine: '{request.file_engine}'. "
            f"Available: {', '.join(available)}",
        )
    settings.STT_FILE_ENGINE = request.file_engine
    return {
        "file_engine": settings.STT_FILE_ENGINE,
        "available": available,
    }
