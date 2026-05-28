"""LLM 요약 / 정제 / 액션아이템 / 프롬프트 라우터."""
import asyncio
import logging
import time

from fastapi import APIRouter, Request

from app.config import settings
from app.deps import get_summarizer
from app.llm.summarizer import LLMSummarizer
from app.schemas import (
    ActionItemResult,
    ActionItemsRequest,
    ActionItemsResponse,
    BuildPromptRequest,
    BuildPromptResponse,
    CorrectTermsRequest,
    CorrectTermsResponse,
    RefineNotesRequest,
    RefineNotesResponse,
    SummarizeRequest,
    SummarizeResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest, http_request: Request) -> SummarizeResponse:
    """회의 트랜스크립트 요약 엔드포인트.

    Args:
        request: { transcripts, type, context }

    Returns:
        { key_points, decisions, discussion_details, action_items }
    """
    t0 = time.monotonic()
    summarizer = get_summarizer(http_request.app, request.llm_config)
    model_name = request.llm_config.model if request.llm_config else settings.LLM_MODEL
    logger.info("[LLM] /summarize 요청 (model=%s, type=%s, transcripts=%d건)", model_name, request.type, len(request.transcripts))
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    result = await summarizer.summarize(
        transcripts_dicts,
        summary_type=request.type,
        context=request.context,
    )
    logger.info("[LLM] /summarize 완료 (%.1f초)", time.monotonic() - t0)
    return SummarizeResponse(
        key_points=result["key_points"],
        decisions=result["decisions"],
        discussion_details=result["discussion_details"],
        action_items=[ActionItemResult(**item) for item in result["action_items"]],
    )


@router.post("/refine-notes", response_model=RefineNotesResponse)
async def refine_notes(request: RefineNotesRequest, http_request: Request) -> RefineNotesResponse:
    """회의록 자동 정제 엔드포인트.

    현재 회의록(Markdown) + 새 자막을 받아 오타 교정, 구조화, 통합된 회의록을 반환한다.
    동일 회의에 대한 동시 요청은 순차 처리된다.
    """
    # 회의별 락 — 동시 LLM 호출 방지
    lock_key = request.meeting_title or "_default"
    locks = http_request.app.state.refine_locks
    if lock_key not in locks:
        locks[lock_key] = asyncio.Lock()
    lock = locks[lock_key]

    if lock.locked():
        logger.info("[LLM] /refine-notes 대기 (이전 요청 처리 중: %s)", lock_key)

    async with lock:
        t0 = time.monotonic()
        summarizer = get_summarizer(http_request.app, request.llm_config)
        model_name = request.llm_config.model if request.llm_config else settings.LLM_MODEL
        logger.info("[LLM] /refine-notes 요청 (model=%s, title=%s, transcripts=%d건, notes=%d자)",
                    model_name, request.meeting_title, len(request.transcripts), len(request.current_notes))
        transcripts_dicts = [item.model_dump() for item in request.transcripts]
        result = await summarizer.refine_notes(
            current_notes=request.current_notes,
            transcripts=transcripts_dicts,
            meeting_title=request.meeting_title,
            meeting_type=request.meeting_type,
            sections_prompt=request.sections_prompt,
        )
        logger.info("[LLM] /refine-notes 완료 (%.1f초, 출력=%d자)", time.monotonic() - t0, len(result))
        return RefineNotesResponse(notes_markdown=result)


@router.post("/build-prompt", response_model=BuildPromptResponse)
async def build_prompt(request: BuildPromptRequest, http_request: Request) -> BuildPromptResponse:
    """LLM 호출 없이 완성된 프롬프트 텍스트를 반환한다.

    사용자가 외부 LLM(ChatGPT, Claude 웹 등)에 직접 붙여넣을 수 있는
    자기 완결형 프롬프트를 조립한다.
    """
    summarizer: LLMSummarizer = http_request.app.state.summarizer
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    result = summarizer.build_prompt(
        current_notes=request.current_notes,
        transcripts=transcripts_dicts,
        meeting_title=request.meeting_title,
        sections_prompt=request.sections_prompt,
    )
    return BuildPromptResponse(prompt_text=result)


@router.post("/feedback-notes", response_model=CorrectTermsResponse)
async def correct_terms(request: CorrectTermsRequest) -> CorrectTermsResponse:
    """등록된 용어 매핑을 기반으로 회의록 텍스트를 일괄 치환하는 엔드포인트."""
    result = request.current_notes
    for c in request.corrections:
        result = result.replace(c.from_term, c.to_term)
    return CorrectTermsResponse(notes_markdown=result)


@router.post("/summarize/action-items", response_model=ActionItemsResponse)
async def summarize_action_items(request: ActionItemsRequest, http_request: Request) -> ActionItemsResponse:
    """회의 트랜스크립트에서 Action Item 추출 엔드포인트.

    Args:
        request: { transcripts }

    Returns:
        { action_items: [{ content, assignee_hint, due_date_hint }] }
    """
    summarizer = get_summarizer(http_request.app, request.llm_config)
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    items = await summarizer.extract_action_items(transcripts_dicts)
    return ActionItemsResponse(
        action_items=[ActionItemResult(**item) for item in items],
    )
