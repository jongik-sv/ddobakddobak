"""LLM 출력 마크다운 후처리 — JSON 추출, 코드펜스 제거, Mermaid 라벨 보정."""
import re


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

_NODE_PATTERNS = (
    (_RE_SQUARE_NODE, '[', ']'),
    (_RE_CURLY_NODE, '{', '}'),
    (_RE_PAREN_NODE, '(', ')'),
)


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
        result = mermaid_block
        for pattern, open_b, close_b in _NODE_PATTERNS:
            result = pattern.sub(
                lambda m, ob=open_b, cb=close_b: f"{m.group(1)}{m.group(2)}{_clean_label(m.group(3), ob, cb)}",
                result,
            )
        return result

    return _RE_MERMAID_BLOCK.sub(
        lambda m: f"{m.group(1)}{_quote_labels(m.group(2))}{m.group(3)}",
        text,
    )
