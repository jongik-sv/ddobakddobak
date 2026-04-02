"""LLM 요약 클라이언트.

Anthropic 호환 API, OpenAI 호환 API, 또는 CLI 파이프 모드(claude/gemini/codex)를
사용하여 회의 트랜스크립트를 요약한다. LLM_PROVIDER 설정으로 백엔드를 선택한다.
"""
import asyncio
import json
import logging
import re
import shutil
import time
from typing import Any

import anthropic

from app.config import CLI_LLM_PROVIDERS, settings

logger = logging.getLogger(__name__)


_SUMMARIZE_SYSTEM_PROMPT = """당신은 회의 내용을 분석하여 구조화된 요약을 제공하는 전문가입니다.
트랜스크립트를 분석하여 반드시 아래 JSON 형식으로만 응답하세요.

응답 형식:
{
  "key_points": ["핵심 포인트 1", "핵심 포인트 2"],
  "decisions": ["결정사항 1", "결정사항 2"],
  "discussion_details": ["논의 내용 1", "논의 내용 2"],
  "action_items": [
    {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
  ]
}

JSON 외에 다른 텍스트를 포함하지 마세요."""

_ACTION_ITEMS_SYSTEM_PROMPT = """당신은 회의 내용에서 Action Item을 추출하는 전문가입니다.
트랜스크립트를 분석하여 반드시 아래 JSON 형식으로만 응답하세요.

응답 형식:
{
  "action_items": [
    {"content": "할 일 내용", "assignee_hint": "담당자 힌트 또는 null", "due_date_hint": "마감일 힌트 또는 null"}
  ]
}

JSON 외에 다른 텍스트를 포함하지 마세요."""


_DEFAULT_SECTION_STRUCTURE = """2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요 (섹션 번호 부여 권장):
   - ## 1. 핵심 요약 (3~5개 항목. 각 항목을 별도의 Markdown 불릿(- )으로 작성하고 항목 사이에 빈 줄을 넣어 분리할 것. 각 항목은 "맥락 → **결론/핵심**" 구조. 서술형 문장 금지. 여러 항목을 한 줄에 이어붙이지 말 것)
   - ## 2. 논의 사항 (각 주제별로 소제목 사용)
   - ## 3. 결정사항 (결정된 내용을 표로 정리)
   - ## 4. Action Items (담당자, 기한이 있으면 표로 정리)
   - ## 5. 기타 논의 (기타 참고 사항 및 누락된 내용)"""

_REFINE_NOTES_SYSTEM_PROMPT = """당신은 실시간 회의록 작성 전문가입니다.
현재까지 작성된 회의록(Markdown)과 새로운 음성 인식 자막(transcript)을 받아,
통합된 회의록을 작성합니다.

## 핵심 규칙

1. **오타 교정**: 음성 인식(STT) 자막에는 오타가 많습니다. 문맥을 파악하여 반드시 오타를 교정하세요.
   - 예: "개발 환영" → "개발 환경", "테스크" → "태스크", "디플로이" → "배포"
   - 한국어와 영어가 섞인 기술 용어에 특히 주의하세요.

2. **구조화**: 회의록을 다음과 같이 체계적으로 구성하세요 (섹션 번호 부여 권장):
   - ## 1. 핵심 요약 (3~5개 항목. 각 항목을 별도의 Markdown 불릿(- )으로 작성하고 항목 사이에 빈 줄을 넣어 분리할 것. 각 항목은 "맥락 → **결론/핵심**" 구조. 서술형 문장 금지. 여러 항목을 한 줄에 이어붙이지 말 것)
   - ## 2. 논의 사항 (각 주제별로 소제목 사용)
   - ## 3. 결정사항 (결정된 내용을 표로 정리)
   - ## 4. Action Items (담당자, 기한이 있으면 표로 정리)
   - ## 5. 기타 논의 (기타 참고 사항 및 누락된 내용)

3. **표 적극 활용**: 비교, 목록, 현황 등은 Markdown 표로 정리하세요.
   예시:
   | 항목 | 담당자 | 기한 | 상태 |
   |------|--------|------|------|
   | API 설계 | 김개발 | 3/28 | 진행중 |

4. **[최우선] 기존 내용 보존**: 기존 회의록의 모든 내용은 반드시 빠짐없이 포함해야 합니다.
   - ⚠️ 기존 회의록에 있던 내용을 절대 삭제하거나 생략하지 마세요.
   - ⚠️ 기존 내용을 요약·축약하여 줄이지 마세요. 원래 분량 그대로 유지하세요.
   - 새로운 자막 내용만 기존 회의록에 추가/병합하세요.

5. **점진적 업데이트**: 기존 회의록 구조를 유지하면서 새로운 내용을 자연스럽게 통합하세요.
   - 기존 섹션에 해당하는 내용이면 해당 섹션 끝에 추가
   - 새로운 주제면 새 소제목 생성
   - 이전 내용과 정확히 중복되는 경우에만 합치기 (유사한 내용은 모두 유지)

6. **간결한 문체**: 어미를 최대한 간결하게 작성하세요.
   - "~했습니다", "~하였습니다" 대신 "~함", "~완료", "~예정" 등 명사형/체언 종결 사용
   - "~하기로 했습니다" → "~하기로 함", "~진행할 예정입니다" → "~진행 예정"
   - 불필요한 조사와 서술어를 줄이고 핵심만 남기세요

7. **Markdown만 반환**: 전체 출력을 ```markdown 블록으로 감싸지 마세요. 단, 본문 내 ```mermaid 코드블록은 허용됩니다.

8. **수식·단위 표기**: LaTeX 수식($...$)을 사용하지 마세요. 대신 유니코드 문자를 사용하세요.
   - 위첨자: ² ³ ⁴ ⁿ ⁻¹ (예: m², cm³, 10⁶)
   - 아래첨자: ₀ ₁ ₂ (예: CO₂, H₂O)
   - 기호: ± × ÷ ≤ ≥ ≠ ≈ ° ‰ μ Ω π α β γ → ← ∞
   - 분수: ½ ⅓ ¼ ⅔ ¾
   - 예시: g/m² (O) / $g/m^2$ (X), CO₂ (O) / $CO_2$ (X)

9. **다이어그램 활용**: 시각적 표현이 효과적인 부분은 Mermaid 다이어그램을 사용하세요.
   - 적합한 경우: 프로세스/워크플로우, 타임라인, 의사결정 흐름, 시스템 구조, 의존관계, 비율/통계
   - 부적합한 경우: 단순 목록, 짧은 정보, 이미 표로 충분한 내용
   - 형식: ```mermaid ... ``` 코드블록 사용
   - 지원 유형: flowchart(프로세스), sequenceDiagram(상호작용), gantt(일정), pie(비율), mindmap(아이디어맵)
   - 회의록 당 최대 2개, 내용이 충분히 복잡할 때만 추가
   - 다이어그램 노드/라벨은 한국어로 작성
   - ⚠️ **[필수] 노드 라벨에 반드시 따옴표 사용**: 예외 없이 모든 노드 라벨을 큰따옴표로 감싸세요.
     - 따옴표 없는 노드는 파싱 에러를 유발하므로 절대 사용 금지입니다.
     - ✅ 올바른 예: A["개근중량 입력"] --> B{"공정 구분"} --> C["도금 부착량 (g/m²) × 길이"]
     - ❌ 잘못된 예: A[개근중량 입력] --> B{공정 구분} --> C[도금 부착량 × 길이]
     - 다이아몬드 노드도 마찬가지: B{"조건 분기"} (O) / B{조건 분기} (X)
   - ⚠️ **[필수] 노드 라벨 내 줄바꿈은 \\n 대신 <br/>을 사용하세요.**
     - Mermaid에서 \\n은 줄바꿈으로 인식되지 않아 렌더링 오류를 유발합니다.
     - ✅ 올바른 예: A["첫째 줄<br/>둘째 줄"]
     - ❌ 잘못된 예: A["첫째 줄\n둘째 줄"] (실제 줄바꿈 또는 문자열 \n 모두 금지)

## 출력 형식

순수 Markdown 텍스트만 반환하세요. JSON이 아닙니다.
```markdown 블록으로 감싸지 마세요. ```mermaid 코드블록은 본문 내에서 사용 가능합니다."""


_FEEDBACK_NOTES_SYSTEM_PROMPT = """당신은 회의록 편집 전문가입니다.
현재 회의록(Markdown)과 사용자의 피드백(지시사항)을 받아 회의록을 수정합니다.

## 규칙
1. 사용자의 피드백을 정확하게 반영하여 회의록을 수정하세요.
2. 피드백에서 언급하지 않은 부분은 가능한 그대로 유지하세요.
3. 전체 구조와 형식은 유지하면서 필요한 부분만 변경하세요.
4. Markdown만 반환: 전체 출력을 ```markdown 블록으로 감싸지 마세요. 단, 본문 내 ```mermaid 코드블록은 허용됩니다.
5. 다이어그램: 사용자가 다이어그램을 요청하면 ```mermaid 코드블록을 사용하세요.
   지원 유형: flowchart, sequenceDiagram, gantt, pie, mindmap. 라벨은 한국어로 작성.
6. 수식·단위 표기: LaTeX 수식($...$)을 사용하지 마세요. 유니코드 문자를 사용하세요.
   - 위첨자: ² ³ ⁴, 아래첨자: ₀ ₁ ₂, 기호: ± × ÷ ≤ ≥ ≠ ≈ ° μ π → ∞
   - 예: g/m² (O) / $g/m^2$ (X), CO₂ (O) / $CO_2$ (X)
7. [필수] Mermaid 노드 라벨에 반드시 큰따옴표 사용 — 예외 없음. A["라벨"] (O) / A[라벨] (X). 다이아몬드도 B{"조건"} (O) / B{조건} (X)
8. [필수] Mermaid 노드 라벨 내 줄바꿈은 \\n 대신 <br/> 사용. A["첫째 줄<br/>둘째 줄"] (O) / A["첫째 줄\n둘째 줄"] (X)

## 출력 형식
순수 Markdown 텍스트만 반환하세요. JSON이 아닙니다.
```markdown 블록으로 감싸지 마세요. ```mermaid 코드블록은 본문 내에서 사용 가능합니다."""


def _build_refine_prompt_from_text(sections_prompt: str) -> str:
    """Rails에서 전달된 sections_prompt 텍스트로 시스템 프롬프트를 생성한다."""
    return _REFINE_NOTES_SYSTEM_PROMPT.replace(_DEFAULT_SECTION_STRUCTURE, sections_prompt)


def _extract_json(text: str) -> str:
    """```json ... ``` 마크다운 블록 또는 순수 JSON 문자열을 추출한다."""
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        return match.group(1).strip()
    return text.strip()


def _strip_markdown_fence(text: str) -> str:
    """```markdown ... ``` 코드 블록 래퍼를 제거한다.

    본문 내 ```mermaid 등 언어 태그가 있는 코드블록은 보존한다.
    """
    if re.match(r"^```(?:markdown)?\s*\n", text):
        text = re.sub(r"^```(?:markdown)?\s*\n", "", text)
        text = re.sub(r"\n```\s*$", "", text)
    return text


_RE_MERMAID_BLOCK = re.compile(r"(```mermaid\s*\n)([\s\S]*?)(```)")
_RE_NODE_PFX = r'(^|\s|>|\|)'
_RE_SQUARE_NODE = re.compile(_RE_NODE_PFX + r'(\w+)\[([^\]]+)\]', re.MULTILINE)
_RE_CURLY_NODE = re.compile(_RE_NODE_PFX + r'(\w+)\{([^\}]+)\}', re.MULTILINE)
_RE_PAREN_NODE = re.compile(_RE_NODE_PFX + r'(\w+)\(([^\)]+)\)', re.MULTILINE)


def _fix_mermaid_quotes(text: str) -> str:
    """Mermaid 코드블록 내 노드 라벨에 큰따옴표를 자동 보정하고 줄바꿈을 처리한다.

    1. 따옴표 없는 라벨(A[라벨])에 큰따옴표를 추가한다.
    2. 라벨 내부에 중첩된 큰따옴표(A["FMS("설명")"])를 제거한다.
    3. 라벨 내부의 줄바꿈(\\n 또는 실제 개행)을 <br/>로 교체한다.
    """

    def _clean_label(content: str, open_b: str, close_b: str) -> str:
        """라벨 내용에서 큰따옴표를 제거하고 줄바꿈을 <br/>로 바꾼 후 외부 따옴표만 씌운다."""
        clean = content.replace('"', '')
        clean = clean.replace('\\n', '<br/>')
        clean = clean.replace('\n', '<br/>').replace('\r', '')
        return f'{open_b}"{clean}"{close_b}'

    def _quote_labels(mermaid_block: str) -> str:
        result = _RE_SQUARE_NODE.sub(
            lambda m: f"{m.group(1)}{m.group(2)}{_clean_label(m.group(3), '[', ']')}",
            mermaid_block,
        )
        result = _RE_CURLY_NODE.sub(
            lambda m: f"{m.group(1)}{m.group(2)}{_clean_label(m.group(3), '{', '}')}",
            result,
        )
        result = _RE_PAREN_NODE.sub(
            lambda m: f"{m.group(1)}{m.group(2)}{_clean_label(m.group(3), '(', ')')}",
            result,
        )
        return result

    return _RE_MERMAID_BLOCK.sub(
        lambda m: f"{m.group(1)}{_quote_labels(m.group(2))}{m.group(3)}",
        text,
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
        """트랜스크립트 목록을 프롬프트용 텍스트로 포맷한다."""
        if not transcripts:
            return ""
        lines = []
        for item in transcripts:
            speaker = item.get("speaker", "알 수 없음")
            text = item.get("text", "")
            lines.append(f"{speaker}: {text}")
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

    async def apply_feedback(
        self,
        current_notes: str,
        feedback: str,
        meeting_title: str = "",
    ) -> str:
        """사용자 피드백을 반영하여 회의록을 수정한다.

        Args:
            current_notes: 현재 회의록 (Markdown)
            feedback: 사용자가 입력한 피드백/지시사항
            meeting_title: 회의 제목

        Returns:
            수정된 회의록 Markdown 문자열
        """
        parts = []
        if meeting_title:
            parts.append(f"회의 제목: {meeting_title}")
        if current_notes.strip():
            parts.append(f"현재 회의록:\n{current_notes}")
        else:
            parts.append("현재 회의록: (아직 없음 — 피드백 내용을 바탕으로 새로 작성해주세요)")
        parts.append(f"사용자 피드백:\n{feedback}")

        user_content = "\n\n".join(parts)

        try:
            result = (await self._call_llm_raw(
                _FEEDBACK_NOTES_SYSTEM_PROMPT, user_content, self._settings.LLM_MAX_OUTPUT_TOKENS
            )).strip()
            return _fix_mermaid_quotes(_strip_markdown_fence(result))
        except Exception as e:
            logger.error("apply_feedback failed: %s", e)
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
