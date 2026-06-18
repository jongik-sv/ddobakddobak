"""LLM 요약 클라이언트.

Anthropic 호환 API, OpenAI 호환 API, 또는 CLI 파이프 모드(claude/gemini/codex)를
사용하여 회의 트랜스크립트를 요약한다. LLM_PROVIDER 설정으로 백엔드를 선택한다.
"""
import asyncio
import json
import logging
import shutil
import time
from typing import Any

import anthropic

from app.config import CLI_LLM_PROVIDERS, settings

logger = logging.getLogger(__name__)

from app.llm.markdown_postprocess import (
    _extract_json,
    _fix_mermaid_quotes,
    _strip_markdown_fence,
)
from app.llm.prompts import (
    _ACTION_ITEMS_SYSTEM_PROMPT,
    _REFINE_NOTES_SYSTEM_PROMPT,
    _SUMMARIZE_SYSTEM_PROMPT,
    _build_refine_prompt_from_text,
)


class LLMSummarizer:
    """LLM 기반 회의 요약 클라이언트.

    LLM_PROVIDER에 따라 Anthropic 또는 OpenAI 호환 API를 사용한다.
    """

    def __init__(self, client: Any | None = None, settings_override: Any | None = None) -> None:
        self._settings = settings_override or settings
        self._provider = self._settings.LLM_PROVIDER
        self._client = client if client is not None else self._build_client()

    def _build_client(self) -> Any:
        """설정에 따라 적절한 LLM 클라이언트를 생성한다."""
        if self._provider in CLI_LLM_PROVIDERS:
            return None  # CLI 모드는 클라이언트 객체 불필요
        if self._provider == "openai":
            return self._build_openai_client()
        return self._build_anthropic_client()

    def _build_anthropic_client(self) -> anthropic.AsyncAnthropic:
        """Anthropic 호환 비동기 클라이언트를 생성한다."""
        kwargs: dict[str, Any] = {"api_key": self._settings.ANTHROPIC_AUTH_TOKEN}
        if self._settings.ANTHROPIC_BASE_URL:
            kwargs["base_url"] = self._settings.ANTHROPIC_BASE_URL
        return anthropic.AsyncAnthropic(**kwargs)

    def _build_openai_client(self) -> Any:
        """OpenAI 호환 비동기 클라이언트를 생성한다."""
        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError(
                "openai 패키지가 설치되어 있지 않습니다. "
                "'pip install openai'로 설치 후 재시작하세요."
            )
        kwargs: dict[str, Any] = {
            "api_key": self._settings.OPENAI_API_KEY or "dummy",
        }
        if self._settings.OPENAI_BASE_URL:
            kwargs["base_url"] = self._settings.OPENAI_BASE_URL
        return AsyncOpenAI(**kwargs)

    def _format_transcripts(self, transcripts: list[dict]) -> str:
        """트랜스크립트 목록을 프롬프트용 텍스트로 포맷한다(발화 시각 포함)."""
        if not transcripts:
            return ""
        lines = []
        for item in transcripts:
            speaker = item.get("speaker", "알 수 없음")
            text = item.get("text", "")
            ms = int(item.get("started_at_ms", 0) or 0)
            clock = f"{ms // 60000:02d}:{(ms // 1000) % 60:02d}"
            lines.append(f"[{clock}|{ms}ms {speaker}] {text}")
        return "\n".join(lines)

    # ── CLI 파이프 모드 호출 ──────────────────────────────────────────────────

    async def _run_cli(self, cmd: list[str], stdin_text: str) -> str:
        """CLI 서브프로세스를 실행하고 stdout을 반환한다."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=stdin_text.encode("utf-8")),
                timeout=180,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise TimeoutError("CLI 응답 시간이 초과되었습니다 (180초).")

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                f"CLI 오류 (코드 {proc.returncode}): {err_msg}"
            )
        return stdout.decode("utf-8").strip()

    async def _call_claude_cli(self, system: str, user_content: str) -> str:
        """Claude Code CLI (-p) 를 사용하여 LLM을 호출한다."""
        cli = self._settings.CLAUDE_CLI_PATH
        if not shutil.which(cli):
            raise FileNotFoundError(
                f"Claude CLI를 찾을 수 없습니다: '{cli}'. "
                "Claude Code가 설치되어 있는지 확인하세요."
            )
        cmd = [
            cli, "-p",
            "--output-format", "text",
            "--system-prompt", system,
        ]
        if self._settings.LLM_MODEL:
            cmd.extend(["--model", self._settings.LLM_MODEL])
        return await self._run_cli(cmd, user_content)

    async def _call_gemini_cli(self, system: str, user_content: str) -> str:
        """Gemini CLI (-p) 를 사용하여 LLM을 호출한다."""
        cli = self._settings.GEMINI_CLI_PATH
        if not shutil.which(cli):
            raise FileNotFoundError(
                f"Gemini CLI를 찾을 수 없습니다: '{cli}'. "
                "npm install -g @google/gemini-cli 로 설치하세요."
            )
        merged = f"[시스템 지시]\n{system}\n\n[사용자 입력]\n{user_content}"
        cmd = [cli, "-p", merged, "--output-format", "text"]
        if self._settings.LLM_MODEL:
            cmd.extend(["--model", self._settings.LLM_MODEL])
        return await self._run_cli(cmd, "")

    async def _call_codex_cli(self, system: str, user_content: str) -> str:
        """OpenAI Codex CLI (exec) 를 사용하여 LLM을 호출한다."""
        cli = self._settings.CODEX_CLI_PATH
        if not shutil.which(cli):
            raise FileNotFoundError(
                f"Codex CLI를 찾을 수 없습니다: '{cli}'. "
                "npm install -g @openai/codex 로 설치하세요."
            )
        cmd = [cli, "exec", "-"]
        if self._settings.LLM_MODEL:
            cmd.extend(["--model", self._settings.LLM_MODEL])
        merged = f"[시스템 지시]\n{system}\n\n[사용자 입력]\n{user_content}"
        return await self._run_cli(cmd, merged)

    # ── LLM 호출 공통 인터페이스 ──────────────────────────────────────────────

    async def _call_llm_raw(self, system: str, user_content: str, max_tokens: int) -> str:
        """LLM을 비동기로 호출하여 텍스트 응답을 반환한다."""
        if self._provider in CLI_LLM_PROVIDERS:
            t0 = time.monotonic()
            input_len = len(system) + len(user_content)
            if self._provider == "claude_cli":
                result = await self._call_claude_cli(system, user_content)
            elif self._provider == "gemini_cli":
                result = await self._call_gemini_cli(system, user_content)
            else:
                result = await self._call_codex_cli(system, user_content)
            elapsed = time.monotonic() - t0
            logger.info(
                "LLM [%s/%s] %.1fs | input=%d자 output=%d자",
                self._provider, self._settings.LLM_MODEL, elapsed, input_len, len(result),
            )
            return result

        t0 = time.monotonic()
        if self._provider == "openai":
            # Qwen3.5 등 thinking 모드 모델은 enable_thinking=false로 비활성화
            extra: dict[str, Any] = {}
            if "qwen" in self._settings.LLM_MODEL.lower():
                extra["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
            response = await self._client.chat.completions.create(
                model=self._settings.LLM_MODEL,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
                **extra,
            )
            elapsed = time.monotonic() - t0
            usage = getattr(response, "usage", None)
            if usage:
                logger.info(
                    "LLM [%s] %.1fs | input=%d output=%d total=%d tokens",
                    self._settings.LLM_MODEL, elapsed,
                    usage.prompt_tokens, usage.completion_tokens, usage.total_tokens,
                )
            else:
                logger.info("LLM [%s] %.1fs | usage not available", self._settings.LLM_MODEL, elapsed)
            return response.choices[0].message.content or ""
        else:
            response = await self._client.messages.create(
                model=self._settings.LLM_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            elapsed = time.monotonic() - t0
            usage = getattr(response, "usage", None)
            if usage:
                logger.info(
                    "LLM [%s] %.1fs | input=%d output=%d tokens",
                    self._settings.LLM_MODEL, elapsed,
                    usage.input_tokens, usage.output_tokens,
                )
            else:
                logger.info("LLM [%s] %.1fs | usage not available", self._settings.LLM_MODEL, elapsed)
            return response.content[0].text

    async def _call_llm(self, system: str, user_content: str, max_tokens: int) -> dict | None:
        """LLM을 비동기로 호출하여 JSON 응답을 파싱한다. 실패 시 None 반환."""
        try:
            text = await self._call_llm_raw(system, user_content, max_tokens)
            return json.loads(_extract_json(text))
        except (json.JSONDecodeError, KeyError, IndexError):
            return None

    async def summarize(
        self,
        transcripts: list[dict],
        summary_type: str,
        context: str | None = None,
    ) -> dict:
        """트랜스크립트를 요약한다.

        Args:
            transcripts: 트랜스크립트 목록 [{"speaker", "text", "started_at_ms"}, ...]
            summary_type: "realtime" | "final"
            context: 이전 실시간 요약 내용 (선택)

        Returns:
            {"key_points", "decisions", "discussion_details", "action_items"}
        """
        transcript_text = self._format_transcripts(transcripts)
        user_content = f"요약 유형: {summary_type}\n\n회의 트랜스크립트:\n{transcript_text}"
        if context:
            user_content += f"\n\n이전 요약 컨텍스트:\n{context}"

        data = await self._call_llm(_SUMMARIZE_SYSTEM_PROMPT, user_content, max_tokens=self._settings.LLM_MAX_OUTPUT_TOKENS)
        if data is None:
            return {"key_points": [], "decisions": [], "discussion_details": [], "action_items": []}
        return {
            "key_points": data.get("key_points", []),
            "decisions": data.get("decisions", []),
            "discussion_details": data.get("discussion_details", []),
            "action_items": data.get("action_items", []),
        }

    async def extract_action_items(self, transcripts: list[dict]) -> list[dict]:
        """트랜스크립트에서 Action Item을 추출한다.

        Args:
            transcripts: 트랜스크립트 목록

        Returns:
            [{"content", "assignee_hint", "due_date_hint"}, ...]
        """
        transcript_text = self._format_transcripts(transcripts)
        user_content = f"회의 트랜스크립트:\n{transcript_text}"

        data = await self._call_llm(_ACTION_ITEMS_SYSTEM_PROMPT, user_content, max_tokens=self._settings.LLM_MAX_OUTPUT_TOKENS)
        if data is None:
            return []
        return data.get("action_items", [])

    async def refine_notes(
        self,
        current_notes: str,
        transcripts: list[dict],
        meeting_title: str = "",
        meeting_type: str = "general",
        sections_prompt: str | None = None,
    ) -> str:
        """현재 회의록 + 새 자막을 통합하여 정제된 회의록을 반환한다.

        오타 교정, 표/구조화 포맷 적용, 점진적 업데이트를 수행한다.

        Args:
            current_notes: 현재까지의 회의록 (Markdown)
            transcripts: 새로 추가된 자막 목록
            meeting_title: 회의 제목

        Returns:
            정제된 회의록 Markdown 문자열
        """
        transcript_text = self._format_transcripts(transcripts)
        if not transcript_text:
            return current_notes

        parts = []
        if meeting_title:
            parts.append(f"회의 제목: {meeting_title}")
        if current_notes.strip():
            parts.append(f"현재 회의록:\n{current_notes}")
        else:
            parts.append("현재 회의록: (아직 없음 — 새로 작성해주세요)")
        parts.append(f"새로운 자막:\n{transcript_text}")

        user_content = "\n\n".join(parts)

        # 기존 회의록 길이에 비례하여 max_tokens를 동적으로 설정
        # 한국어는 글자당 ~1토큰이므로 len()을 그대로 사용
        # 기존 내용 전체 보존 + 새 내용 추가 여유분
        estimated_tokens = len(current_notes) + len(transcript_text) + 2048
        max_tokens = max(4096, min(estimated_tokens, self._settings.LLM_MAX_OUTPUT_TOKENS))

        try:
            if sections_prompt:
                system_prompt = _build_refine_prompt_from_text(sections_prompt)
            else:
                system_prompt = _REFINE_NOTES_SYSTEM_PROMPT
            result = (await self._call_llm_raw(
                system_prompt, user_content, max_tokens
            )).strip()
            return _fix_mermaid_quotes(_strip_markdown_fence(result))
        except Exception as e:
            logger.error("refine_notes failed: %s", e)
            return current_notes

    def build_prompt(
        self,
        current_notes: str,
        transcripts: list[dict],
        meeting_title: str = "",
        sections_prompt: str | None = None,
    ) -> str:
        """LLM에 전달할 전체 프롬프트를 조립하여 반환한다. LLM은 호출하지 않는다.

        사용자가 외부 LLM(ChatGPT, Claude 웹 등)에 직접 붙여넣을 수 있는
        자기 완결형 프롬프트를 생성한다.
        """
        if sections_prompt:
            system_prompt = _build_refine_prompt_from_text(sections_prompt)
        else:
            system_prompt = _REFINE_NOTES_SYSTEM_PROMPT

        transcript_text = self._format_transcripts(transcripts)
        parts = []
        if meeting_title:
            parts.append(f"회의 제목: {meeting_title}")
        if current_notes.strip():
            parts.append(f"현재 회의록:\n{current_notes}")
        else:
            parts.append("현재 회의록: (아직 없음 — 새로 작성해주세요)")
        if transcript_text:
            parts.append(f"새로운 자막:\n{transcript_text}")
        user_content = "\n\n".join(parts)

        return (
            "# 회의록 작성 프롬프트\n\n"
            "아래 내용을 LLM(ChatGPT, Claude 등)에 그대로 붙여넣으면 회의록이 생성됩니다.\n\n"
            "---\n\n"
            "## 지시사항\n\n"
            f"{system_prompt}\n\n"
            "---\n\n"
            "## 입력 데이터\n\n"
            f"{user_content}"
        )
