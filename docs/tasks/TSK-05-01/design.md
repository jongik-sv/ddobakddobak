# TSK-05-01: LLM 요약 클라이언트 구현 - 설계

## 구현 방향

anthropic SDK를 사용하여 ZAI GLM (Anthropic 호환 API)에 연결하는 LLM 요약 클라이언트를 구현한다.
`LLMSummarizer` 클래스가 트랜스크립트 입력을 받아 구조화된 요약(key_points, decisions, discussion_details, action_items)을 반환한다.
FastAPI 엔드포인트 `POST /summarize`, `POST /summarize/action-items`를 main.py에 추가한다.
테스트에서는 `anthropic.Anthropic` 클라이언트를 mock으로 교체하여 실제 API 호출 없이 검증한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| sidecar/app/llm/__init__.py | 패키지 선언 | 신규 |
| sidecar/app/llm/summarizer.py | LLMSummarizer 클래스 구현 | 신규 |
| sidecar/app/config.py | ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, LLM_MODEL 설정 추가 | 수정 |
| sidecar/app/main.py | POST /summarize, POST /summarize/action-items 엔드포인트 추가 | 수정 |
| sidecar/pyproject.toml | anthropic 의존성 추가 | 수정 |
| sidecar/tests/test_summarizer.py | LLMSummarizer 단위 테스트 | 신규 |

## 주요 구조

```python
# LLMSummarizer
class LLMSummarizer:
    def __init__(self, client: anthropic.Anthropic | None = None)
    async def summarize(transcripts, type, context) -> SummaryResult
    async def extract_action_items(transcripts) -> list[ActionItem]
    def _build_client() -> anthropic.Anthropic  # ENV 기반 생성
    def _format_transcripts(transcripts) -> str  # 프롬프트용 텍스트 포맷
```

```python
# Pydantic 요청/응답 모델 (main.py 내)
class TranscriptItem(BaseModel): speaker, text, started_at_ms
class SummarizeRequest(BaseModel): transcripts, type ("realtime"|"final"), context
class SummarizeResponse(BaseModel): key_points, decisions, discussion_details, action_items
class ActionItemsRequest(BaseModel): transcripts
class ActionItemResult(BaseModel): content, assignee_hint, due_date_hint
class ActionItemsResponse(BaseModel): action_items
```

## 데이터 흐름

**POST /summarize:**
1. 요청 수신 → `LLMSummarizer.summarize()` 호출
2. 트랜스크립트 텍스트로 포맷 → 시스템 프롬프트 + 사용자 프롬프트 구성
3. `client.messages.create()` 호출 (동기 → run_in_executor로 비동기화)
4. JSON 응답 파싱 → SummarizeResponse 반환

**POST /summarize/action-items:**
1. 요청 수신 → `LLMSummarizer.extract_action_items()` 호출
2. Action Item 추출 특화 프롬프트 구성
3. LLM 응답 파싱 → ActionItemsResponse 반환

## LLM 설정

- Client: `anthropic.Anthropic(api_key=ANTHROPIC_AUTH_TOKEN, base_url=ANTHROPIC_BASE_URL)`
- Model: `settings.LLM_MODEL` (기본값: "glm-4-flash")
- 응답 포맷: JSON (system prompt에 JSON 구조 명시)
- 파싱 실패 시: 빈 구조 반환 (예외 무전파)

## 선행 조건

- TSK-00-03 완료 (FastAPI 기반 sidecar 구조)
- anthropic SDK 설치 (pyproject.toml에 추가)
