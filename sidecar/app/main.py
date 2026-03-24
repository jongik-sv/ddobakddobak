"""FastAPI 앱 진입점."""
import asyncio
import base64
import binascii
import dataclasses
import gc
import multiprocessing
import os
import re
from contextlib import asynccontextmanager

# macOS 세마포어 누수 방지
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")
if multiprocessing.get_start_method(allow_none=True) is None:
    multiprocessing.set_start_method("spawn")
# CPU 텐서 공유를 파일 기반으로 전환 → POSIX 세마포어 생성 방지
try:
    import torch.multiprocessing as _tmp
    _tmp.set_sharing_strategy("file_system")
    del _tmp
except Exception:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.config import settings
from app.llm.summarizer import LLMSummarizer
from app.stt.factory import create_stt_adapter


class HealthResponse(BaseModel):
    """GET /health 응답 스키마."""
    status: str
    stt_engine: str
    model_loaded: bool


class UpdateSttEngineRequest(BaseModel):
    """PUT /settings/stt-engine 요청 스키마."""
    engine: str


def _is_model_cached(model_id: str) -> bool:
    """HuggingFace 캐시 디렉터리에 모델 스냅샷이 존재하는지 직접 확인한다.

    scan_cache_dir() 대신 경로 직접 검사를 사용해 속도와 신뢰성을 높인다.
    HF_HUB_CACHE / HF_HOME 환경 변수를 자동으로 반영한다.
    """
    try:
        from pathlib import Path
        from huggingface_hub.constants import HF_HUB_CACHE
        # HF 캐시 폴더명 규칙: models--{org}--{model_name}
        model_dir = Path(HF_HUB_CACHE) / ("models--" + model_id.replace("/", "--"))
        snapshots = model_dir / "snapshots"
        return snapshots.exists() and any(snapshots.iterdir())
    except Exception:
        return False


def _detect_available_engines() -> list[str]:
    """설치된 패키지 및 다운로드된 모델 기준으로 사용 가능한 STT 엔진 목록을 반환한다."""
    available = ["mock"]
    try:
        import pywhispercpp  # noqa: F401
        available.append("whisper_cpp")
    except ImportError:
        pass
    try:
        import mlx_audio  # noqa: F401
        # Qwen3-ASR 1.7B 양자화 모델 — 캐시에 있는 것만 표시
        from app.stt.factory import _QWEN3_MODEL_IDS
        for engine_id, model_id in _QWEN3_MODEL_IDS.items():
            if _is_model_cached(model_id):
                available.append(engine_id)
    except ImportError:
        pass
    return available


AVAILABLE_STT_ENGINES = _detect_available_engines()


class TranscribeRequest(BaseModel):
    """POST /transcribe 요청 스키마."""
    audio: str  # base64 인코딩된 PCM 16kHz Int16 바이너리
    meeting_id: int | None = None  # 회의별 화자 DB 분리를 위한 ID
    diarization_config: dict | None = None  # optional: {enable, similarity_threshold, merge_threshold, max_embeddings_per_speaker}
    languages: list[str] | None = None  # 인식 대상 언어 코드 목록 (예: ["ko", "en"])

    @field_validator("audio")
    @classmethod
    def validate_base64(cls, v: str) -> str:
        try:
            base64.b64decode(v, validate=True)
        except Exception as e:
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


class TranscribeFileResponse(BaseModel):
    """POST /transcribe-file 응답 스키마."""
    segments: list[SegmentResponse]
    total_duration_ms: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 STT 모델을 로드하고, 종료 시 정리한다."""
    app.state.stt_adapter = create_stt_adapter()
    await app.state.stt_adapter.load_model()
    app.state.summarizer = LLMSummarizer()
    app.state.engine_lock = asyncio.Lock()

    # 화자 구분 모델 로드 (HF_TOKEN이 있을 때만)
    # 파이프라인은 하나만 로드하고, 회의별 diarizer는 파이프라인을 공유
    app.state.diarizer_pipeline = None   # 공유 ML 파이프라인
    app.state.meeting_diarizers: dict[int, Any] = {}  # {meeting_id: SpeakerDiarizer}
    if settings.HF_TOKEN:
        try:
            from app.diarization.speaker import SpeakerDiarizer
            _loader = SpeakerDiarizer()
            await _loader.load(hf_token=settings.HF_TOKEN)
            app.state.diarizer_pipeline = _loader._pipeline
            print("✓ 화자 구분 모델 로드 완료")
        except Exception as e:
            print(f"⚠ 화자 구분 모델 로드 실패 (화자 구분 없이 계속): {e}")

    yield

    # 종료 시 리소스 명시적 해제 (세마포어 누수 방지)
    app.state.stt_adapter = None
    app.state.diarizer_pipeline = None
    app.state.meeting_diarizers.clear()
    gc.collect()


app = FastAPI(
    title="ddobakddobak sidecar",
    description="STT / 화자 분리 / AI 요약 Python Sidecar 서비스",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """헬스체크 엔드포인트.

    Returns:
        status: 서버 상태 ("ok")
        stt_engine: 현재 설정된 STT 엔진 이름
        model_loaded: STT 모델 로드 여부
    """
    adapter = getattr(app.state, "stt_adapter", None)
    return HealthResponse(
        status="ok",
        stt_engine=settings.STT_ENGINE,
        model_loaded=adapter.is_loaded if adapter is not None else False,
    )


@app.get("/settings/stt-engine")
async def get_stt_engine() -> dict:
    """현재 STT 엔진 설정과 사용 가능한 엔진 목록을 반환한다."""
    adapter = getattr(app.state, "stt_adapter", None)
    return {
        "current": settings.STT_ENGINE,
        "available": AVAILABLE_STT_ENGINES,
        "model_loaded": adapter.is_loaded if adapter is not None else False,
    }


@app.put("/settings/stt-engine")
async def update_stt_engine(request: UpdateSttEngineRequest) -> HealthResponse:
    """STT 엔진을 런타임에 변경한다."""
    from fastapi import HTTPException
    if request.engine not in AVAILABLE_STT_ENGINES:
        raise HTTPException(
            status_code=422,
            detail=f"'{request.engine}' 엔진을 사용할 수 없습니다. 사용 가능한 엔진: {AVAILABLE_STT_ENGINES}"
        )
    # 동시에 여러 번 전환 요청이 와도 하나씩 처리
    lock: asyncio.Lock = app.state.engine_lock
    if lock.locked():
        raise HTTPException(status_code=409, detail="모델 변경이 이미 진행 중입니다. 잠시 후 다시 시도하세요.")
    async with lock:
        # 같은 엔진이면 스킵
        if settings.STT_ENGINE == request.engine:
            adapter = app.state.stt_adapter
            return HealthResponse(status="ok", stt_engine=settings.STT_ENGINE, model_loaded=adapter.is_loaded)
        # 이전 모델을 먼저 해제하여 Metal GPU 컨텍스트 충돌 방지
        # (pywhispercpp + mlx-audio 동시 Metal 사용 시 크래시 발생)
        old_adapter = app.state.stt_adapter
        app.state.stt_adapter = None  # type: ignore[assignment]
        del old_adapter
        gc.collect()  # 즉시 GC로 Metal 리소스 해제 보장

        try:
            new_adapter = create_stt_adapter(request.engine)
            await new_adapter.load_model()
        except (ImportError, NotImplementedError) as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"모델 로드 실패: {e}") from e
        app.state.stt_adapter = new_adapter
        settings.STT_ENGINE = request.engine
        return HealthResponse(
            status="ok",
            stt_engine=settings.STT_ENGINE,
            model_loaded=new_adapter.is_loaded,
        )


_LANG_PATTERNS: dict[str, re.Pattern[str]] = {
    "ko": re.compile(r"[\uAC00-\uD7A3]"),
    "ja": re.compile(r"[\u3040-\u30FF\u4E00-\u9FFF]"),
    "zh": re.compile(r"[\u4E00-\u9FFF]"),
    "en": re.compile(r"[a-zA-Z]"),
    "es": re.compile(r"[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]"),
    "fr": re.compile(r"[a-zA-ZàâçéèêëîïôùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛÜŸŒÆ]"),
    "de": re.compile(r"[a-zA-ZäöüßÄÖÜ]"),
    "th": re.compile(r"[\u0E01-\u0E5B]"),
    "vi": re.compile(r"[a-zA-Zàáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]"),
}


def _filter_by_languages(segments: list, languages: list[str] | None = None) -> list:
    """선택된 언어에 해당하는 세그먼트만 남긴다.

    languages가 None이거나 빈 리스트이면 기존 한국어 전용 필터를 적용한다.
    """
    if not languages:
        languages = ["ko"]

    patterns = [_LANG_PATTERNS[lang] for lang in languages if lang in _LANG_PATTERNS]
    if not patterns:
        return segments

    def matches(text: str) -> bool:
        return any(p.search(text) for p in patterns)

    filtered = [seg for seg in segments if matches(seg.text)]
    removed = len(segments) - len(filtered)
    if removed:
        print(f"[stt] 비대상 언어 세그먼트 {removed}개 필터링 (대상: {languages})", flush=True)
    return filtered


def _get_meeting_diarizer(meeting_id: int | None, diarization_config: dict | None = None):
    """회의별 SpeakerDiarizer를 가져온다 (없으면 생성)."""
    from app.diarization.speaker import make_meeting_diarizer
    pipeline = getattr(app.state, "diarizer_pipeline", None)
    if pipeline is None or meeting_id is None:
        return None
    # 프론트엔드에서 화자분리 비활성화 요청
    if diarization_config and not diarization_config.get("enable", True):
        return None
    diarizers: dict = app.state.meeting_diarizers
    if meeting_id not in diarizers:
        kwargs = {}
        if diarization_config:
            kwargs = {k: v for k, v in diarization_config.items() if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        diarizers[meeting_id] = make_meeting_diarizer(meeting_id, pipeline, **kwargs)
    elif diarization_config:
        # Update existing diarizer thresholds
        d = diarizers[meeting_id]
        if 'similarity_threshold' in diarization_config:
            d._similarity_threshold = diarization_config['similarity_threshold']
        if 'merge_threshold' in diarization_config:
            d._merge_threshold = diarization_config['merge_threshold']
        if 'max_embeddings_per_speaker' in diarization_config:
            d._max_embeddings = diarization_config['max_embeddings_per_speaker']
    return diarizers[meeting_id]


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    """배치 STT 엔드포인트.

    base64 인코딩된 PCM 16kHz mono Int16 오디오를 받아 텍스트로 변환한다.

    Args:
        request: { audio: base64_string, meeting_id: int | None }

    Returns:
        { segments: [TranscriptSegment, ...] }
    """
    from fastapi import HTTPException
    adapter = app.state.stt_adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="STT 모델 변경 중입니다. 잠시 후 다시 시도하세요.")
    audio_bytes = base64.b64decode(request.audio)

    # STT와 화자 분리를 병렬 실행 (Qwen3=Metal GPU, pyannote=CPU → 동시 가능)
    diarizer = _get_meeting_diarizer(request.meeting_id, request.diarization_config)
    langs = request.languages
    if diarizer:
        stt_result, diarization_result = await asyncio.gather(
            adapter.transcribe(audio_bytes),
            diarizer.diarize(audio_bytes),
            return_exceptions=True,
        )
        segments = stt_result if not isinstance(stt_result, BaseException) else []
        segments = _filter_by_languages(segments, langs)
        if not isinstance(diarization_result, BaseException) and diarization_result and segments:
            print(f"[diarizer] result={diarization_result}", flush=True)
            segments = diarizer.merge_with_segments(segments, diarization_result)
        elif isinstance(diarization_result, BaseException):
            print(f"[diarizer] ERROR: {diarization_result}", flush=True)
    else:
        segments = await adapter.transcribe(audio_bytes)
        segments = _filter_by_languages(segments, langs)

    return TranscribeResponse(
        segments=[SegmentResponse(**dataclasses.asdict(seg)) for seg in segments]
    )


@app.post("/transcribe-file", response_model=TranscribeFileResponse)
async def transcribe_file(request: TranscribeFileRequest) -> TranscribeFileResponse:
    """오디오 파일 전체 STT + 화자분리 + 한국어 문장 분리 엔드포인트.

    Backend가 ffmpeg로 변환한 raw PCM 16kHz mono Int16 파일 경로를 받아
    전체 파일을 정교하게 변환한다.
    """
    from fastapi import HTTPException
    import os

    adapter = app.state.stt_adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="STT 모델 변경 중입니다.")

    if not os.path.isfile(request.file_path):
        raise HTTPException(status_code=400, detail=f"파일을 찾을 수 없습니다: {request.file_path}")

    # 1. 파일 읽기
    with open(request.file_path, "rb") as f:
        audio_bytes = f.read()

    if len(audio_bytes) < 3200:  # 최소 0.1초
        raise HTTPException(status_code=400, detail="오디오 파일이 너무 짧습니다.")

    total_duration_ms = int(len(audio_bytes) / (_SAMPLE_RATE * _BYTES_PER_SAMPLE) * 1000)
    print(f"[transcribe-file] 파일 크기={len(audio_bytes)} bytes, 길이={total_duration_ms}ms", flush=True)

    # 2. STT 실행 — 파일 변환은 항상 Whisper 사용
    # Whisper는 내부적으로 ~30초 윈도우로 분할하여 정확한 타임스탬프와 다수 세그먼트를 반환.
    # Qwen3는 내부 분할이 없어 파일 단위 처리에 부적합.
    from app.stt.whisper_adapter import WhisperAdapter
    file_adapter = adapter
    _whisper_loaded_here = False
    if not isinstance(adapter, WhisperAdapter):
        print("[transcribe-file] Whisper 엔진으로 전환하여 파일 처리", flush=True)
        file_adapter = WhisperAdapter()
        await file_adapter.load_model()
        _whisper_loaded_here = True

    try:
        segments = await file_adapter.transcribe(audio_bytes)
    finally:
        # 임시로 로드한 Whisper 정리 (Metal GPU 충돌 방지)
        if _whisper_loaded_here:
            del file_adapter
            import gc; gc.collect()

    segments = _filter_by_languages(segments)  # 파일 변환은 기본 한국어 필터
    print(f"[transcribe-file] STT 세그먼트 {len(segments)}개", flush=True)

    # 3. 화자 분리 (옵션 — diarization_config에 enable: true가 있을 때만 실행)
    enable_diarization = (request.diarization_config or {}).get("enable", False)
    if enable_diarization:
        diarizer = _get_meeting_diarizer(request.meeting_id, request.diarization_config)
        if diarizer:
            try:
                diarization_result = await diarizer.diarize(audio_bytes)
                if diarization_result and segments:
                    segments = diarizer.merge_with_segments(segments, diarization_result)
                    print(f"[transcribe-file] 화자 분리 완료", flush=True)
            except Exception as e:
                print(f"[transcribe-file] 화자 분리 실패 (무시): {e}", flush=True)
    else:
        print(f"[transcribe-file] 화자 분리 스킵", flush=True)

    # 4. 한국어 문장 분리 후처리
    from app.stt.sentence_segmenter import segment_korean_sentences
    segments = segment_korean_sentences(segments)
    print(f"[transcribe-file] 문장 분리 후 {len(segments)}개 세그먼트", flush=True)

    return TranscribeFileResponse(
        segments=[SegmentResponse(**dataclasses.asdict(seg)) for seg in segments],
        total_duration_ms=total_duration_ms,
    )


# sidecar/app/main.py에서 사용하는 상수 (파일 엔드포인트용)
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2


async def _chunked_transcribe(
    adapter,
    audio_bytes: bytes,
    chunk_sec: int = 15,
    overlap_sec: int = 2,
) -> list:
    """Qwen3 등 내부 분할이 없는 엔진을 위해 오디오를 청크로 나눠 처리한다.

    각 청크의 타임스탬프를 전체 파일 기준 절대값으로 보정한다.
    """
    from app.stt.base import TranscriptSegment

    bytes_per_sec = _SAMPLE_RATE * _BYTES_PER_SAMPLE
    chunk_bytes = chunk_sec * bytes_per_sec
    overlap_bytes = overlap_sec * bytes_per_sec
    step_bytes = chunk_bytes - overlap_bytes

    total_len = len(audio_bytes)
    all_segments: list[TranscriptSegment] = []
    offset = 0
    chunk_idx = 0

    while offset < total_len:
        end = min(offset + chunk_bytes, total_len)
        chunk = audio_bytes[offset:end]

        if len(chunk) < bytes_per_sec:  # 1초 미만이면 스킵
            break

        offset_ms = int(offset / bytes_per_sec * 1000)
        segments = await adapter.transcribe(chunk)

        for seg in segments:
            seg.started_at_ms += offset_ms
            seg.ended_at_ms += offset_ms
            all_segments.append(seg)

        chunk_idx += 1
        if chunk_idx % 10 == 0:
            print(f"[transcribe-file] 청크 {chunk_idx} 처리 완료 ({offset_ms}ms / {int(total_len / bytes_per_sec * 1000)}ms)", flush=True)

        offset += step_bytes

    print(f"[transcribe-file] 총 {chunk_idx}개 청크 처리 완료", flush=True)
    return all_segments


@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):
    """실시간 STT WebSocket 엔드포인트.

    클라이언트는 binary 프레임으로 PCM 16kHz mono Int16 청크를 전송한다.
    서버는 STT 변환 결과를 JSON으로 응답한다.

    Output JSON:
        {
          "type": "partial" | "final",
          "text": str,
          "speaker": str | null,
          "started_at_ms": int,
          "ended_at_ms": int,
          "seq": int
        }
    """
    await websocket.accept()
    adapter = app.state.stt_adapter
    seq = 0

    try:
        while True:
            audio_bytes = await websocket.receive_bytes()
            segments = await adapter.transcribe(audio_bytes)

            # 화자 구분 적용
            diarizer = app.state.diarizer
            if diarizer and diarizer.is_loaded and segments:
                try:
                    diarization = await diarizer.diarize(audio_bytes)
                    segments = diarizer.merge_with_segments(segments, diarization)
                except Exception:
                    pass

            for seg in segments:
                seq += 1
                await websocket.send_json({
                    "type": "final",
                    "text": seg.text,
                    "speaker": seg.speaker_label,
                    "started_at_ms": seg.started_at_ms,
                    "ended_at_ms": seg.ended_at_ms,
                    "seq": seq,
                })
    except WebSocketDisconnect:
        pass


# ── LLM 요약 스키마 ──────────────────────────────────────────────────────────

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


class SummarizeRequest(BaseModel):
    """POST /summarize 요청 스키마."""
    transcripts: list[TranscriptItem]
    type: str = "final"  # "realtime" | "final"
    context: str | None = None


class SummarizeResponse(BaseModel):
    """POST /summarize 응답 스키마."""
    key_points: list[str]
    decisions: list[str]
    discussion_details: list[str]
    action_items: list[ActionItemResult]


class ActionItemsRequest(BaseModel):
    """POST /summarize/action-items 요청 스키마."""
    transcripts: list[TranscriptItem]


class ActionItemsResponse(BaseModel):
    """POST /summarize/action-items 응답 스키마."""
    action_items: list[ActionItemResult]


# ── LLM 요약 엔드포인트 ──────────────────────────────────────────────────────

# ── 화자 관리 엔드포인트 ──────────────────────────────────────────────────────

class UpdateLlmSettingsRequest(BaseModel):
    """PUT /settings/llm 요청 스키마."""
    auth_token: str | None = None
    base_url: str | None = None
    model: str | None = None


class UpdateHfSettingsRequest(BaseModel):
    """PUT /settings/hf 요청 스키마."""
    hf_token: str


def _mask_token(token: str) -> str:
    """토큰을 마스킹한다 (앞 4자 + *** + 뒤 4자)."""
    if not token or len(token) <= 8:
        return "****" if token else ""
    return f"{token[:4]}{'*' * (len(token) - 8)}{token[-4:]}"


@app.get("/settings/llm")
async def get_llm_settings() -> dict:
    """현재 LLM 설정을 반환한다."""
    return {
        "auth_token_masked": _mask_token(settings.ANTHROPIC_AUTH_TOKEN),
        "base_url": settings.ANTHROPIC_BASE_URL,
        "model": settings.LLM_MODEL,
    }


@app.put("/settings/llm")
async def update_llm_settings(request: UpdateLlmSettingsRequest) -> dict:
    """LLM 설정을 런타임에 변경하고 클라이언트를 재생성한다."""
    if request.auth_token is not None:
        settings.ANTHROPIC_AUTH_TOKEN = request.auth_token
    if request.base_url is not None:
        settings.ANTHROPIC_BASE_URL = request.base_url
    if request.model is not None:
        settings.LLM_MODEL = request.model

    # LLM 클라이언트 재생성
    app.state.summarizer = LLMSummarizer()

    return {
        "auth_token_masked": _mask_token(settings.ANTHROPIC_AUTH_TOKEN),
        "base_url": settings.ANTHROPIC_BASE_URL,
        "model": settings.LLM_MODEL,
    }


@app.get("/settings/hf")
async def get_hf_settings() -> dict:
    """현재 HuggingFace 설정을 반환한다."""
    return {
        "hf_token_masked": _mask_token(settings.HF_TOKEN),
        "has_token": bool(settings.HF_TOKEN),
    }


@app.put("/settings/hf")
async def update_hf_settings(request: UpdateHfSettingsRequest) -> dict:
    """HuggingFace 토큰을 런타임에 변경한다."""
    settings.HF_TOKEN = request.hf_token

    # 화자 구분 모델 재로드 시도
    if request.hf_token and app.state.diarizer_pipeline is None:
        try:
            from app.diarization.speaker import SpeakerDiarizer
            _loader = SpeakerDiarizer()
            await _loader.load(hf_token=request.hf_token)
            app.state.diarizer_pipeline = _loader._pipeline
        except Exception:
            pass

    return {
        "hf_token_masked": _mask_token(settings.HF_TOKEN),
        "has_token": bool(settings.HF_TOKEN),
    }


class RenameSpeakerRequest(BaseModel):
    """PUT /speakers/{speaker_id} 요청 스키마."""
    name: str


@app.get("/speakers")
async def get_speakers(meeting_id: int) -> dict:
    """회의별 등록된 화자 목록을 반환한다."""
    diarizer = _get_meeting_diarizer(meeting_id)
    if diarizer is None:
        return {"speakers": []}
    return {"speakers": diarizer.get_speakers()}


@app.put("/speakers/{speaker_id}")
async def rename_speaker(speaker_id: str, meeting_id: int, request: RenameSpeakerRequest) -> dict:
    """화자에 이름을 부여한다."""
    from fastapi import HTTPException
    import urllib.parse
    decoded_id = urllib.parse.unquote(speaker_id)
    diarizer = _get_meeting_diarizer(meeting_id)
    if diarizer is None:
        raise HTTPException(status_code=503, detail="화자 구분 모델이 비활성화 상태입니다.")
    if not diarizer.rename_speaker(decoded_id, request.name):
        raise HTTPException(status_code=404, detail=f"화자 '{decoded_id}'를 찾을 수 없습니다.")
    return {"id": decoded_id, "name": request.name}


@app.delete("/speakers")
async def reset_speakers(meeting_id: int) -> dict:
    """회의의 화자 DB를 초기화한다."""
    diarizer = _get_meeting_diarizer(meeting_id)
    if diarizer is not None:
        diarizer.reset_db()
        # 메모리에서도 제거
        app.state.meeting_diarizers.pop(meeting_id, None)
    return {"ok": True}


@app.post("/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest) -> SummarizeResponse:
    """회의 트랜스크립트 요약 엔드포인트.

    Args:
        request: { transcripts, type, context }

    Returns:
        { key_points, decisions, discussion_details, action_items }
    """
    summarizer: LLMSummarizer = app.state.summarizer
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    result = await summarizer.summarize(
        transcripts_dicts,
        summary_type=request.type,
        context=request.context,
    )
    return SummarizeResponse(
        key_points=result["key_points"],
        decisions=result["decisions"],
        discussion_details=result["discussion_details"],
        action_items=[ActionItemResult(**item) for item in result["action_items"]],
    )


class RefineNotesRequest(BaseModel):
    """POST /refine-notes 요청 스키마."""
    current_notes: str = ""
    transcripts: list[TranscriptItem]
    meeting_title: str = ""
    meeting_type: str = "general"


class RefineNotesResponse(BaseModel):
    """POST /refine-notes 응답 스키마."""
    notes_markdown: str


@app.post("/refine-notes", response_model=RefineNotesResponse)
async def refine_notes(request: RefineNotesRequest) -> RefineNotesResponse:
    """회의록 자동 정제 엔드포인트.

    현재 회의록(Markdown) + 새 자막을 받아 오타 교정, 구조화, 통합된 회의록을 반환한다.
    """
    summarizer: LLMSummarizer = app.state.summarizer
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    result = await summarizer.refine_notes(
        current_notes=request.current_notes,
        transcripts=transcripts_dicts,
        meeting_title=request.meeting_title,
        meeting_type=request.meeting_type,
    )
    return RefineNotesResponse(notes_markdown=result)


class FeedbackNotesRequest(BaseModel):
    """POST /feedback-notes 요청 스키마."""
    current_notes: str = ""
    feedback: str
    meeting_title: str = ""


class FeedbackNotesResponse(BaseModel):
    """POST /feedback-notes 응답 스키마."""
    notes_markdown: str


@app.post("/feedback-notes", response_model=FeedbackNotesResponse)
async def feedback_notes(request: FeedbackNotesRequest) -> FeedbackNotesResponse:
    """사용자 피드백을 반영하여 회의록을 수정하는 엔드포인트."""
    summarizer: LLMSummarizer = app.state.summarizer
    result = await summarizer.apply_feedback(
        current_notes=request.current_notes,
        feedback=request.feedback,
        meeting_title=request.meeting_title,
    )
    return FeedbackNotesResponse(notes_markdown=result)


@app.post("/summarize/action-items", response_model=ActionItemsResponse)
async def summarize_action_items(request: ActionItemsRequest) -> ActionItemsResponse:
    """회의 트랜스크립트에서 Action Item 추출 엔드포인트.

    Args:
        request: { transcripts }

    Returns:
        { action_items: [{ content, assignee_hint, due_date_hint }] }
    """
    summarizer: LLMSummarizer = app.state.summarizer
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    items = await summarizer.extract_action_items(transcripts_dicts)
    return ActionItemsResponse(
        action_items=[ActionItemResult(**item) for item in items],
    )
