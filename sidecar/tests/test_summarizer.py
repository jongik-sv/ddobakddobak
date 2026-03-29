"""LLMSummarizer 단위 테스트."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import Settings
from app.llm.summarizer import LLMSummarizer


def _test_settings(**overrides) -> Settings:
    """테스트용 Settings (기본: anthropic provider)."""
    defaults = {"LLM_PROVIDER": "anthropic", "ANTHROPIC_AUTH_TOKEN": "test", "ANTHROPIC_BASE_URL": "", "LLM_MODEL": "test-model"}
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.fixture
def mock_client():
    """anthropic.AsyncAnthropic 클라이언트 mock."""
    client = MagicMock()
    client.messages.create = AsyncMock()
    return client


@pytest.fixture
def summarizer(mock_client):
    """mock 클라이언트를 주입한 LLMSummarizer."""
    return LLMSummarizer(client=mock_client, settings_override=_test_settings())


def _make_message_response(content_text: str):
    """anthropic 응답 mock 생성 헬퍼."""
    msg = MagicMock()
    msg.content = [MagicMock(text=content_text)]
    return msg


def _set_mock_response(mock_client, content_text: str):
    """mock_client.messages.create 반환값을 설정하는 헬퍼."""
    mock_client.messages.create.return_value = _make_message_response(content_text)


SAMPLE_TRANSCRIPTS = [
    {"speaker": "화자1", "text": "이번 분기 매출 목표에 대해 논의하겠습니다.", "started_at_ms": 0},
    {"speaker": "화자2", "text": "현재 달성률은 80%입니다.", "started_at_ms": 5000},
    {"speaker": "화자1", "text": "마케팅팀에서 추가 캠페인을 진행하기로 했습니다.", "started_at_ms": 10000},
]

SAMPLE_SUMMARY_JSON = {
    "key_points": ["매출 목표 달성률 80%"],
    "decisions": ["마케팅 추가 캠페인 진행"],
    "discussion_details": ["이번 분기 매출 목표 논의"],
    "action_items": [
        {"content": "캠페인 기획서 작성", "assignee_hint": "화자2", "due_date_hint": "2026-04-01"}
    ],
}

SAMPLE_ACTION_ITEMS_JSON = {
    "action_items": [
        {"content": "캠페인 기획서 작성", "assignee_hint": "화자2", "due_date_hint": "2026-04-01"}
    ]
}


class TestLLMSummarizerInit:
    def test_init_with_client(self, mock_client):
        s = LLMSummarizer(client=mock_client)
        assert s._client is mock_client

    def test_init_without_client_uses_env(self):
        with patch("app.llm.summarizer.anthropic.AsyncAnthropic") as mock_cls, \
             patch("app.llm.summarizer.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "anthropic"
            mock_settings.ANTHROPIC_AUTH_TOKEN = "test-token"
            mock_settings.ANTHROPIC_BASE_URL = ""
            mock_cls.return_value = MagicMock()
            s = LLMSummarizer()
            mock_cls.assert_called_once()
            assert s._client is mock_cls.return_value


class TestLLMSummarizerSummarize:
    @pytest.mark.asyncio
    async def test_summarize_returns_key_points(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert result["key_points"] == ["매출 목표 달성률 80%"]

    @pytest.mark.asyncio
    async def test_summarize_returns_decisions(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert result["decisions"] == ["마케팅 추가 캠페인 진행"]

    @pytest.mark.asyncio
    async def test_summarize_returns_discussion_details(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert "discussion_details" in result

    @pytest.mark.asyncio
    async def test_summarize_returns_action_items(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert len(result["action_items"]) == 1
        assert result["action_items"][0]["content"] == "캠페인 기획서 작성"

    @pytest.mark.asyncio
    async def test_summarize_passes_type_in_prompt(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="realtime")
        call_kwargs = mock_client.messages.create.call_args
        messages = call_kwargs.kwargs["messages"]
        user_content = messages[0]["content"]
        assert "realtime" in user_content

    @pytest.mark.asyncio
    async def test_summarize_passes_context_when_provided(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_SUMMARY_JSON)
        )
        await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="realtime", context="이전 요약 내용")
        call_kwargs = mock_client.messages.create.call_args
        messages = call_kwargs.kwargs["messages"]
        user_content = messages[0]["content"]
        assert "이전 요약 내용" in user_content

    @pytest.mark.asyncio
    async def test_summarize_returns_empty_on_json_parse_error(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            "invalid json response"
        )
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert result["key_points"] == []
        assert result["decisions"] == []
        assert result["discussion_details"] == []
        assert result["action_items"] == []

    @pytest.mark.asyncio
    async def test_summarize_handles_markdown_json_block(self, summarizer, mock_client):
        """```json ... ``` 블록으로 감싸진 응답 파싱."""
        wrapped = f"```json\n{json.dumps(SAMPLE_SUMMARY_JSON)}\n```"
        mock_client.messages.create.return_value = _make_message_response(wrapped)
        result = await summarizer.summarize(SAMPLE_TRANSCRIPTS, summary_type="final")
        assert result["key_points"] == ["매출 목표 달성률 80%"]


class TestLLMSummarizerExtractActionItems:
    @pytest.mark.asyncio
    async def test_extract_action_items_returns_list(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_ACTION_ITEMS_JSON)
        )
        result = await summarizer.extract_action_items(SAMPLE_TRANSCRIPTS)
        assert isinstance(result, list)
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_extract_action_items_has_required_fields(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_ACTION_ITEMS_JSON)
        )
        result = await summarizer.extract_action_items(SAMPLE_TRANSCRIPTS)
        item = result[0]
        assert "content" in item
        assert "assignee_hint" in item
        assert "due_date_hint" in item

    @pytest.mark.asyncio
    async def test_extract_action_items_returns_empty_on_error(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response("broken")
        result = await summarizer.extract_action_items(SAMPLE_TRANSCRIPTS)
        assert result == []

    @pytest.mark.asyncio
    async def test_extract_action_items_calls_llm_once(self, summarizer, mock_client):
        mock_client.messages.create.return_value = _make_message_response(
            json.dumps(SAMPLE_ACTION_ITEMS_JSON)
        )
        await summarizer.extract_action_items(SAMPLE_TRANSCRIPTS)
        assert mock_client.messages.create.call_count == 1


class TestFormatTranscripts:
    def test_format_transcripts_includes_speaker(self):
        s = LLMSummarizer(client=MagicMock())
        formatted = s._format_transcripts(SAMPLE_TRANSCRIPTS)
        assert "화자1" in formatted
        assert "화자2" in formatted

    def test_format_transcripts_includes_text(self):
        s = LLMSummarizer(client=MagicMock())
        formatted = s._format_transcripts(SAMPLE_TRANSCRIPTS)
        assert "매출 목표" in formatted

    def test_format_transcripts_empty_list(self):
        s = LLMSummarizer(client=MagicMock())
        formatted = s._format_transcripts([])
        assert formatted == ""


@pytest.fixture
def mock_summarizer():
    """엔드포인트 테스트용 mock LLMSummarizer."""
    s = MagicMock(spec=LLMSummarizer)

    async def fake_summarize(transcripts, summary_type="final", context=None):
        return {
            "key_points": ["매출 목표 달성률 80%"],
            "decisions": ["마케팅 추가 캠페인 진행"],
            "discussion_details": ["이번 분기 매출 목표 논의"],
            "action_items": [
                {"content": "캠페인 기획서 작성", "assignee_hint": "화자2", "due_date_hint": "2026-04-01"}
            ],
        }

    async def fake_extract(transcripts):
        return [{"content": "캠페인 기획서 작성", "assignee_hint": "화자2", "due_date_hint": "2026-04-01"}]

    s.summarize = fake_summarize
    s.extract_action_items = fake_extract
    return s


@pytest.fixture
def endpoint_client(mock_summarizer):
    """lifespan summarizer를 mock으로 교체한 TestClient."""
    from fastapi.testclient import TestClient
    from app.main import app

    with patch("app.llm.summarizer.anthropic.AsyncAnthropic"):
        with TestClient(app) as client:
            app.state.summarizer = mock_summarizer
            yield client


class TestSummarizeEndpoint:
    """FastAPI POST /summarize 엔드포인트 통합 테스트."""

    def test_summarize_endpoint_returns_200(self, endpoint_client):
        response = endpoint_client.post(
            "/summarize",
            json={"transcripts": SAMPLE_TRANSCRIPTS, "type": "final"},
        )
        assert response.status_code == 200

    def test_summarize_endpoint_response_schema(self, endpoint_client):
        response = endpoint_client.post(
            "/summarize",
            json={"transcripts": SAMPLE_TRANSCRIPTS, "type": "final"},
        )
        data = response.json()
        assert "key_points" in data
        assert "decisions" in data
        assert "discussion_details" in data
        assert "action_items" in data

    def test_summarize_action_items_endpoint_returns_200(self, endpoint_client):
        response = endpoint_client.post(
            "/summarize/action-items",
            json={"transcripts": SAMPLE_TRANSCRIPTS},
        )
        assert response.status_code == 200

    def test_summarize_action_items_endpoint_response_schema(self, endpoint_client):
        response = endpoint_client.post(
            "/summarize/action-items",
            json={"transcripts": SAMPLE_TRANSCRIPTS},
        )
        data = response.json()
        assert "action_items" in data
        assert isinstance(data["action_items"], list)
