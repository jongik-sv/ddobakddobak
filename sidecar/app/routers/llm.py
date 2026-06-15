"""LLM 요약 / 정제 / 액션아이템 / 프롬프트 라우터."""
import asyncio
import logging
import time
from dataclasses import dataclass

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


@dataclass
class _RefineLockEntry:
    """회의별 refine 락 + 현재 이 키를 사용/대기 중인 요청 수.

    waiters가 0이 되면 refine_locks dict에서 제거해 회의 누적에 따른 락 객체
    무한 증가(누수)를 막는다.
    """
    lock: asyncio.Lock
    waiters: int = 0


@router.post("/refine-notes", response_model=RefineNotesResponse)
async def refine_notes(request: RefineNotesRequest, http_request: Request) -> RefineNotesResponse:
    """회의록 자동 정제 엔드포인트.

    현재 회의록(Markdown) + 새 자막을 받아 오타 교정, 구조화, 통합된 회의록을 반환한다.
    동일 회의에 대한 동시 요청은 순차 처리된다.
    """
    # 회의별 락 — 동시 LLM 호출 방지. 사용/대기 요청 수(waiters)를 세어 0이 되면
    # dict에서 제거한다(회의가 무한히 늘면 락 객체가 영구 누적되던 누수를 차단).
    # 단순 삭제는 불가: 대기 중이던 요청이 쥔 락과 새 요청이 만든 락이 달라져
    # 직렬화가 깨진다. 그래서 아무도 안 쓰는(waiters==0) 순간에만 제거한다.
    lock_key = request.meeting_title or "_default"
    locks = http_request.app.state.refine_locks
    entry = locks.get(lock_key)
    if entry is None:
        entry = _RefineLockEntry(asyncio.Lock())
        locks[lock_key] = entry
    # asyncio는 단일 스레드 — get→증가 사이에 await가 없어 원자적이다.
    entry.waiters += 1
    lock = entry.lock

    if lock.locked():
        logger.info("[LLM] /refine-notes 대기 (이전 요청 처리 중: %s)", lock_key)

    try:
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
    finally:
        entry.waiters -= 1
        if entry.waiters == 0:
            # 아무도 이 회의를 기다리지 않음 → dict에서 제거 (무한 누적 차단)
            locks.pop(lock_key, None)


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
