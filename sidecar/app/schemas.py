"""Sidecar API 요청/응답 Pydantic 스키마."""
from __future__ import annotations

import binascii

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HealthResponse(BaseModel):
    """GET /health 응답 스키마."""
    status: str
    stt_engine: str
    model_loaded: bool
    gpu_resident: bool = True  # STT 모델이 현재 GPU에 상주 중인지 (유휴 오프로드 상태 반영)
    model_state: str = "gpu"  # "gpu" | "cpu" | "unloaded"
    embed_state: str = "unloaded"  # KURE 임베딩 인코더 상주 상태 (lazy load라 기본은 unloaded)


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
    diarization_config: dict | None = None  # {enable, ahc_threshold, ...}
    languages: list[str] | None = None  # 인식 대상 언어 코드 목록 (예: ["ko", "ja"])
    file_chunk_sec: int = 30  # 청크 분할 시간 (초). 0이면 분할 안 함 (Whisper 내부 윈도우 사용)
    mode: str = "single"  # "single"=언어 강제 / "multi"=자동감지+감지언어 필터


class TranscribeFileResponse(BaseModel):
    """POST /transcribe-file 응답 스키마."""
    segments: list[SegmentResponse]
    total_duration_ms: int
    engine: str | None = None  # 실제 사용된 배치 STT 엔진(resolve 후). 회의 정보 기록용


class DiarizeFileRequest(BaseModel):
    """POST /diarize-file — 기존 세그먼트에 화자분리만 재실행(STT 없음)."""
    file_path: str  # PCM 16kHz mono Int16 경로 (backend가 ffmpeg 변환)
    meeting_id: int | None = None
    segments: list[dict]  # [{started_at_ms, ended_at_ms}, ...] 순서 보존
    diarization_config: dict | None = None  # {ahc_threshold, ...}


class DiarizeFileResponse(BaseModel):
    """POST /diarize-file 응답 스키마."""
    segments: list[dict]  # 입력과 같은 순서 [{started_at_ms, ended_at_ms, speaker_label}]


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


# SpeakerDbPayload 상한 — 근거는 실측이다. sidecar/speaker_dbs/*.json 26개 기준
# 최대 12라벨 / 화자당 임베딩 1개 / 임베딩 1024바이트(256-dim float32) /
# 최대 파일 5.7KB이며, 유일한 생산자인 batch_processor는 화자당 [emb] 또는 []만
# 쓴다. 아래 값은 실측 대비 2~3자릿수 여유를 둔 sanity guard다 — 이 sidecar는
# localhost 전용(Rails만 호출)이라 DoS 경계가 아니라, 손상·폭주 payload가
# 무제한 디코드 비용을 유발하는 것을 막는 것이 목적이다.
MAX_SPEAKERS = 1000
MAX_EMBEDDINGS_PER_SPEAKER = 1000
MAX_EMBEDDING_BYTES = 65536  # 16384-dim float32까지 허용 (실측 256-dim의 64배)
# names 쪽 상한 — speakers 쪽과 대칭을 맞춘다. 이전에는 names에 개수·길이
# 제한이 전혀 없어서, 화자 0명짜리 payload로도 무제한 크기의 names를 디스크에
# 쓸 수 있었다. 실측: 파일당 names 최대 8개(라벨은 최대 12개), 이름 최대 22자.
MAX_NAMES = MAX_SPEAKERS
MAX_NAME_CHARS = 256  # 실측 최대 22자의 10배 이상


class RenameSpeakerRequest(BaseModel):
    """PUT /speakers/{speaker_id} 요청 스키마."""
    # 상한은 SpeakerDbPayload.names와 반드시 같아야 한다 — 여기서만 긴 이름을
    # 허용하면 rename으로 만든 DB를 export한 뒤 다시 import할 수 없게 된다.
    name: str = Field(..., max_length=MAX_NAME_CHARS)


_EMBEDDING_ITEMSIZE = 4  # np.float32 itemsize
# 디코드 전 O(1) 차단용 base64 문자열 길이 상한. MAX_EMBEDDING_BYTES 이하의
# 정상 문자열은 절대 걸리지 않도록 보수적으로(넉넉하게) 잡는다.
_MAX_EMBEDDING_B64_CHARS = (MAX_EMBEDDING_BYTES + 2) * 4 // 3 + 4


class SpeakerDbPayload(BaseModel):
    """GET/PUT /speakers/db 요청·응답 스키마 — SpeakerDB 전체 상태(임베딩 포함).

    export/import 왕복을 위해 SpeakerDB의 온디스크 표현을 그대로 반영한다:
    speakers는 {화자 라벨: [base64 인코딩된 float32 임베딩, ...]}.
    """
    next_num: int
    speakers: dict[str, list[str]]
    names: dict[str, str]

    @field_validator("speakers")
    @classmethod
    def validate_embeddings_base64(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        if len(v) > MAX_SPEAKERS:
            raise ValueError(f"화자 수가 상한({MAX_SPEAKERS})을 초과했습니다: {len(v)}")
        for label, emb_list in v.items():
            if len(emb_list) > MAX_EMBEDDINGS_PER_SPEAKER:
                raise ValueError(
                    f"화자 '{label}'의 임베딩 개수가 상한({MAX_EMBEDDINGS_PER_SPEAKER})을 "
                    f"초과했습니다: {len(emb_list)}"
                )
            for b64 in emb_list:
                # 디코드 전 O(1) 차단 — 거대한 문자열을 디코드조차 하지 않는다
                if len(b64) > _MAX_EMBEDDING_B64_CHARS:
                    raise ValueError(
                        f"화자 '{label}'의 임베딩 크기가 "
                        f"상한({MAX_EMBEDDING_BYTES}바이트)을 초과했습니다"
                    )
                try:
                    raw = binascii.a2b_base64(b64, strict_mode=True)
                except binascii.Error as e:
                    raise ValueError(f"화자 '{label}'의 임베딩이 유효한 base64가 아닙니다: {e}") from e
                if len(raw) > MAX_EMBEDDING_BYTES:
                    raise ValueError(
                        f"화자 '{label}'의 임베딩 크기가 상한({MAX_EMBEDDING_BYTES}바이트)을 "
                        f"초과했습니다: {len(raw)}바이트"
                    )
                # 빈 임베딩은 아래 4의 배수 검사(0 % 4 == 0)로는 절대 걸리지 않으므로
                # 별도 분기가 필요하다. 로스터 전멸 벡터는 아니지만(np.frombuffer는
                # 빈 배열을 주고 is_valid_embedding이 걸러낸다) 디스크에 남으면
                # 왕복 무결성이 깨진다 — PUT한 [""]가 다음 GET에선 []이 된다.
                # 문자열이 아니라 '디코드 결과 길이'로 판정한다.
                if len(raw) == 0:
                    raise ValueError(
                        f"화자 '{label}'의 임베딩이 비어 있습니다(0바이트). "
                        f"빈 임베딩은 저장해도 다음 로드에서 사라지므로 거부합니다"
                    )
                # float32 배열로 되살릴 수 없는 길이는 여기서 막는다. 통과시키면
                # 파일은 정상적으로 쓰이지만 다음 SpeakerDB.load()에서
                # np.frombuffer가 ValueError를 던지고, load()의 blanket except가
                # 그 라벨만이 아니라 회의 전체 화자 로스터를 삼킨다.
                # (is_valid_embedding 필터는 frombuffer 뒤라 이걸 막지 못한다.)
                if len(raw) % _EMBEDDING_ITEMSIZE != 0:
                    raise ValueError(
                        f"화자 '{label}'의 임베딩 디코드 길이({len(raw)}바이트)가 "
                        f"float32 크기({_EMBEDDING_ITEMSIZE})의 배수가 아닙니다"
                    )
        return v

    @field_validator("names")
    @classmethod
    def validate_names(cls, v: dict[str, str]) -> dict[str, str]:
        """names에도 speakers와 대칭인 개수·길이 상한을 적용한다."""
        if len(v) > MAX_NAMES:
            raise ValueError(f"이름 수가 상한({MAX_NAMES})을 초과했습니다: {len(v)}")
        for label, name in v.items():
            if len(name) > MAX_NAME_CHARS:
                raise ValueError(
                    f"화자 '{label}'의 이름 길이가 상한({MAX_NAME_CHARS}자)을 "
                    f"초과했습니다: {len(name)}자"
                )
        return v


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


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int
