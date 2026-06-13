"""Sidecar API 요청/응답 Pydantic 스키마."""
from __future__ import annotations

import binascii

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HealthResponse(BaseModel):
    """GET /health 응답 스키마."""
    status: str
    stt_engine: str
    model_loaded: bool


class UpdateSttEngineRequest(BaseModel):
    """PUT /settings/stt-engine 요청 스키마."""
    engine: str


class TranscribeRequest(BaseModel):
    """POST /transcribe 요청 스키마."""
    audio: str  # base64 인코딩된 PCM 16kHz Int16 바이너리
    meeting_id: int | None = None  # 회의별 화자 DB 분리를 위한 ID
    diarization_config: dict | None = None  # optional: {enable, similarity_threshold, merge_threshold, max_embeddings_per_speaker}
    languages: list[str] | None = None  # 인식 대상 언어 코드 목록 (예: ["ko", "en"])
    offset_ms: int = 0  # 청크의 녹음 시작 기준 절대 시작 시각 (스트리밍 화자 분리에 사용)
    mode: str = "single"  # "single"=언어 강제 / "multi"=자동감지+감지언어 필터

    @field_validator("audio")
    @classmethod
    def validate_base64(cls, v: str) -> str:
        if not v:
            raise ValueError("audio 필드가 비어있습니다")
        # base64 alphabet만 검증 (전체 디코딩은 transcribe()에서 1회만 수행)
        try:
            binascii.a2b_base64(v[:32] if len(v) > 32 else v, strict_mode=True)
        except binascii.Error as e:
            raise ValueError(f"audio 필드가 유효한 base64가 아닙니다: {e}") from e
        return v


class SegmentResponse(BaseModel):
    """TranscriptSegment JSON 표현."""
    text: str
    started_at_ms: int
    ended_at_ms: int
    language: str
    confidence: float
    speaker_label: str | None = None


class TranscribeResponse(BaseModel):
    """POST /transcribe 응답 스키마."""
    segments: list[SegmentResponse]


class TranscribeFileRequest(BaseModel):
    """POST /transcribe-file 요청 스키마."""
    file_path: str  # Backend가 ffmpeg로 변환한 raw PCM 16kHz mono Int16 파일 경로
    meeting_id: int | None = None
    diarization_config: dict | None = None
    languages: list[str] | None = None  # 인식 대상 언어 코드 목록 (예: ["ko", "ja"])
    file_chunk_sec: int = 30  # 청크 분할 시간 (초). 0이면 분할 안 함 (Whisper 내부 윈도우 사용)
    mode: str = "single"  # "single"=언어 강제 / "multi"=자동감지+감지언어 필터


class TranscribeFileResponse(BaseModel):
    """POST /transcribe-file 응답 스키마."""
    segments: list[SegmentResponse]
    total_duration_ms: int
    engine: str | None = None  # 실제 사용된 배치 STT 엔진(resolve 후). 회의 정보 기록용


class TranscriptItem(BaseModel):
    """트랜스크립트 단위 항목."""
    speaker: str
    text: str
    started_at_ms: int = 0


class ActionItemResult(BaseModel):
    """Action Item 결과."""
    content: str
    assignee_hint: str | None = None
    due_date_hint: str | None = None


class LlmConfigOverride(BaseModel):
    """사용자별 LLM 설정 오버라이드. 요청에 포함되면 서버 기본값 대신 이 설정을 사용한다."""
    provider: str  # "anthropic" | "openai"
    auth_token: str
    model: str
    base_url: str | None = None


class SummarizeRequest(BaseModel):
    """POST /summarize 요청 스키마."""
    transcripts: list[TranscriptItem]
    type: str = "final"  # "realtime" | "final"
    context: str | None = None
    llm_config: LlmConfigOverride | None = None


class SummarizeResponse(BaseModel):
    """POST /summarize 응답 스키마."""
    key_points: list[str]
    decisions: list[str]
    discussion_details: list[str]
    action_items: list[ActionItemResult]


class ActionItemsRequest(BaseModel):
    """POST /summarize/action-items 요청 스키마."""
    transcripts: list[TranscriptItem]
    llm_config: LlmConfigOverride | None = None


class ActionItemsResponse(BaseModel):
    """POST /summarize/action-items 응답 스키마."""
    action_items: list[ActionItemResult]


class UpdateLlmSettingsRequest(BaseModel):
    """PUT /settings/llm 요청 스키마."""
    provider: str | None = None  # "anthropic", "openai", "claude_cli", "gemini_cli", "codex_cli"
    auth_token: str | None = None
    base_url: str | None = None
    model: str | None = None
    max_input_tokens: int | None = None
    max_output_tokens: int | None = None


class UpdateHfSettingsRequest(BaseModel):
    """PUT /settings/hf 요청 스키마."""
    hf_token: str


class UpdateSttFileEngineRequest(BaseModel):
    """PUT /settings/stt-file-engine 요청 스키마."""
    file_engine: str


class TestLlmRequest(BaseModel):
    """POST /settings/llm/test 요청 스키마."""
    provider: str  # "anthropic", "openai", "claude_cli", "gemini_cli", "codex_cli"
    auth_token: str | None = None
    base_url: str | None = None
    model: str


class RenameSpeakerRequest(BaseModel):
    """PUT /speakers/{speaker_id} 요청 스키마."""
    name: str


class RefineNotesRequest(BaseModel):
    """POST /refine-notes 요청 스키마."""
    current_notes: str = ""
    transcripts: list[TranscriptItem]
    meeting_title: str = ""
    meeting_type: str = "general"
    sections_prompt: str | None = None
    llm_config: LlmConfigOverride | None = None


class RefineNotesResponse(BaseModel):
    """POST /refine-notes 응답 스키마."""
    notes_markdown: str


class BuildPromptRequest(BaseModel):
    """POST /build-prompt 요청 스키마."""
    current_notes: str = ""
    transcripts: list[TranscriptItem]
    meeting_title: str = ""
    sections_prompt: str | None = None


class BuildPromptResponse(BaseModel):
    """POST /build-prompt 응답 스키마."""
    prompt_text: str


class TermCorrection(BaseModel):
    """용어 수정 쌍 (from → to)."""
    from_term: str = Field(..., alias="from")
    to_term: str = Field(..., alias="to")

    model_config = ConfigDict(populate_by_name=True)


class CorrectTermsRequest(BaseModel):
    """POST /feedback-notes 요청 스키마 — 용어 치환."""
    current_notes: str = ""
    corrections: list[TermCorrection]


class CorrectTermsResponse(BaseModel):
    """POST /feedback-notes 응답 스키마."""
    notes_markdown: str
