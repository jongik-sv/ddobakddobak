from app.llm.markdown_postprocess import (
    _extract_json,
    _fix_mermaid_quotes,
    _strip_markdown_fence,
)


def test_strip_fence():
    assert _strip_markdown_fence("```markdown\nhello\n```") == "hello"


def test_strip_fence_preserves_inner_mermaid():
    src = "## 제목\n\n```mermaid\nA --> B\n```"
    assert _strip_markdown_fence(src) == src


def test_extract_json_from_fence():
    assert _extract_json('```json\n{"a": 1}\n```') == '{"a": 1}'


def test_extract_json_plain():
    assert _extract_json('  {"a": 1}  ') == '{"a": 1}'


def test_mermaid_quotes_added():
    src = "```mermaid\nA[라벨] --> B{조건}\n```"
    out = _fix_mermaid_quotes(src)
    assert 'A["라벨"]' in out and 'B{"조건"}' in out


def test_mermaid_newline_to_br():
    src = '```mermaid\nA["첫째\\n둘째"]\n```'
    out = _fix_mermaid_quotes(src)
    assert "<br/>" in out
