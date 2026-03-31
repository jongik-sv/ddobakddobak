"""FastAPI 앱 진입점."""
import asyncio
import base64
import binascii
import dataclasses
import gc
import logging
import multiprocessing
import os
import re
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
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

from app.config import CLI_LLM_PROVIDERS, settings
from app.llm.summarizer import LLMSummarizer
from app.stt.factory import create_stt_adapter

# settings.yaml에서 오디오 최소 청크 길이 로드
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # Int16

def _load_min_chunk_sec() -> float:
    """settings.yaml → config.yaml 순으로 min_chunk_sec를 로드한다."""
    import yaml
    from pathlib import Path
    for candidate in [
        Path(__file__).resolve().parent.parent.parent / "settings.yaml",
        Path(__file__).resolve().parent.parent.parent / "config.yaml",
    ]:
        if candidate.is_file():
            try:
                cfg = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                val = (cfg.get("audio") or {}).get("min_chunk_sec")
                if val is not None:
                    return float(val)
            except Exception:
                continue
    return 1.0  # 기본값 1초

MIN_CHUNK_SEC = _load_min_chunk_sec()
MIN_CHUNK_BYTES = int(MIN_CHUNK_SEC * _SAMPLE_RATE * _BYTES_PER_SAMPLE)


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
    available = []
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
    # faster-whisper (CUDA GPU 또는 CPU 폴백)
    try:
        import faster_whisper  # noqa: F401
        available.append("faster_whisper")
        available.append("faster_whisper_cpu")
    except ImportError:
        pass
    # Qwen3-ASR (qwen-asr 패키지 + NVIDIA CUDA GPU 필수)
    try:
        import torch  # noqa: F401
        import qwen_asr  # noqa: F401
        if torch.cuda.is_available():
            available.append("qwen3_asr_transformers")
            # bitsandbytes 양자화 지원 확인
            try:
                import bitsandbytes  # noqa: F401
                available.append("qwen3_asr_8bit")
                available.append("qwen3_asr_6bit")
            except ImportError:
                pass
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
    offset_ms: int = 0  # 청크의 녹음 시작 기준 절대 시작 시각 (스트리밍 화자 분리에 사용)

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
    languages: list[str] | None = None  # 인식 대상 언어 코드 목록 (예: ["ko", "ja"])
    file_chunk_sec: int = 30  # 청크 분할 시간 (초). 0이면 분할 안 함 (Whisper 내부 윈도우 사용)


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
    app.state.gpu_lock = asyncio.Lock()  # Metal GPU 동시 접근 방지
    app.state.refine_locks: dict[str, asyncio.Lock] = {}  # 회의별 LLM 동시 호출 방지

    # 화자 구분 모델은 lazy load — 첫 요청 시 로드
    app.state.diarizer_pipeline = None   # 공유 ML 파이프라인
    app.state.diarizer_loading = False   # 로드 진행 중 플래그
    app.state.meeting_diarizers: dict[int, Any] = {}  # {meeting_id: SpeakerDiarizer}

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
        _persist_env(STT_ENGINE=settings.STT_ENGINE)
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

    languages가 None이거나 빈 리스트이면 필터링하지 않는다.
    STT 모델이 한국어를 영어/기타 문자로 오인식하는 경우가 빈번하므로
    실시간 STT에서는 필터링을 적용하지 않는다.
    환각(hallucination) 제거는 백엔드의 WHISPER_HALLUCINATIONS에서 처리한다.
    """
    return segments


async def _ensure_diarizer_pipeline():
    """화자 구분 파이프라인을 lazy load한다. 이미 로드됐으면 즉시 반환."""
    if app.state.diarizer_pipeline is not None:
        return app.state.diarizer_pipeline
    if app.state.diarizer_loading:
        return None  # 다른 요청에서 로드 중
    if not settings.HF_TOKEN:
        return None
    app.state.diarizer_loading = True
    try:
        from app.diarization.speaker import SpeakerDiarizer
        _loader = SpeakerDiarizer()
        await _loader.load(hf_token=settings.HF_TOKEN)
        app.state.diarizer_pipeline = _loader._pipeline
        logger.info("화자 구분 모델 lazy load 완료")
        return app.state.diarizer_pipeline
    except Exception as e:
        logger.error("화자 구분 모델 로드 실패: %s", e)
        return None
    finally:
        app.state.diarizer_loading = False


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
            kwargs = {k: v for k, v in diarization_config.items()
                      if k in ('similarity_threshold', 'merge_threshold', 'max_embeddings_per_speaker')}
        diarizers[meeting_id] = make_meeting_diarizer(meeting_id, pipeline, **kwargs)
    elif diarization_config:
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
    t0 = time.monotonic()
    from fastapi import HTTPException
    adapter = app.state.stt_adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="STT 모델 변경 중입니다. 잠시 후 다시 시도하세요.")
    audio_bytes = base64.b64decode(request.audio)
    chunk_sec = len(audio_bytes) / _BYTES_PER_SAMPLE / _SAMPLE_RATE
    logger.info("[STT] /transcribe 요청 (engine=%s, meeting_id=%s, audio=%d bytes, %.1f초)",
                settings.STT_ENGINE, request.meeting_id, len(audio_bytes), chunk_sec)

    # 최소 길이 미만의 오디오는 환각 방지를 위해 스킵
    if len(audio_bytes) < MIN_CHUNK_BYTES:
        logger.info("[STT] /transcribe 스킵 (%.1f초 < 최소 %.1f초)", chunk_sec, MIN_CHUNK_SEC)
        return TranscribeResponse(segments=[])

    # 화자분리 요청 시 파이프라인 lazy load
    if request.diarization_config and request.diarization_config.get("enable"):
        await _ensure_diarizer_pipeline()
    # Metal GPU 동시 접근 방지 — STT(MLX)와 화자분리(MPS) 직렬화
    diarizer = _get_meeting_diarizer(request.meeting_id, request.diarization_config)
    langs = request.languages
    async with app.state.gpu_lock:
        segments = await adapter.transcribe(audio_bytes, languages=langs)
        segments = _filter_by_languages(segments, langs)
        if diarizer and segments:
            try:
                diarization_result = await diarizer.diarize(audio_bytes, offset_ms=request.offset_ms)
                if diarization_result:
                    print(f"[diarizer] result={diarization_result}", flush=True)
                    segments = diarizer.merge_with_segments(segments, diarization_result)
            except Exception as e:
                print(f"[diarizer] ERROR: {e}", flush=True)

    logger.info("[STT] /transcribe 완료 (%.1f초, %d 세그먼트)", time.monotonic() - t0, len(segments))
    return TranscribeResponse(
        segments=[SegmentResponse(**dataclasses.asdict(seg)) for seg in segments]
    )


@app.post("/transcribe-file", response_model=TranscribeFileResponse)
async def transcribe_file(request: TranscribeFileRequest) -> TranscribeFileResponse:
    """오디오 파일 전체 STT + 화자분리 + 한국어 문장 분리 엔드포인트.

    Backend가 ffmpeg로 변환한 raw PCM 16kHz mono Int16 파일 경로를 받아
    전체 파일을 정교하게 변환한다.
    """
    t0 = time.monotonic()
    logger.info("[STT] /transcribe-file 요청 (engine=%s, file=%s)", settings.STT_ENGINE, request.file_path)
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
    from app.stt.whisper_adapter import WhisperAdapter
    file_adapter = adapter
    _whisper_loaded_here = False
    if not isinstance(adapter, WhisperAdapter):
        print("[transcribe-file] Whisper 엔진으로 전환하여 파일 처리", flush=True)
        file_adapter = WhisperAdapter()
        await file_adapter.load_model()
        _whisper_loaded_here = True

    chunk_sec = request.file_chunk_sec
    try:
        if chunk_sec > 0:
            # 청크 분할 모드: 지정된 시간 단위로 분할하여 처리 (다국어 감지에 유리)
            print(f"[transcribe-file] 청크 분할 모드 ({chunk_sec}초)", flush=True)
            segments = await _chunked_transcribe(
                file_adapter, audio_bytes,
                chunk_sec=chunk_sec, overlap_sec=2,
                languages=request.languages,
            )
        else:
            # 분할 없이 Whisper 내부 윈도우(~30초)로 처리
            segments = await file_adapter.transcribe(audio_bytes, languages=request.languages)
    finally:
        if _whisper_loaded_here:
            del file_adapter
            import gc; gc.collect()

    segments = _filter_by_languages(segments, request.languages)
    print(f"[transcribe-file] STT 세그먼트 {len(segments)}개", flush=True)

    # 3. 화자 분리 — WhisperX(ASR+alignment+diarization) 시도, 실패 시 pyannote 배치 폴백
    enable_diarization = (request.diarization_config or {}).get("enable", False)
    if enable_diarization and segments:
        whisperx_result = await _try_whisperx_batch(request, audio_bytes)
        if whisperx_result is not None:
            segments = whisperx_result
            print(f"[transcribe-file] WhisperX 배치 완료: {len(segments)}개 세그먼트", flush=True)
        else:
            # WhisperX 실패 → pyannote 전체 오디오 배치 폴백
            await _ensure_diarizer_pipeline()
            pipeline = getattr(app.state, "diarizer_pipeline", None)
            if pipeline:
                try:
                    from app.diarization.batch_processor import batch_diarize
                    segments = await batch_diarize(audio_bytes, pipeline, segments)
                    print(f"[transcribe-file] pyannote 배치 화자 분리 완료", flush=True)
                except Exception as e:
                    print(f"[transcribe-file] 화자 분리 실패 (무시): {e}", flush=True)
    else:
        print(f"[transcribe-file] 화자 분리 스킵", flush=True)

    # 4. 한국어 문장 분리 후처리
    from app.stt.sentence_segmenter import segment_korean_sentences
    segments = segment_korean_sentences(segments)
    print(f"[transcribe-file] 문장 분리 후 {len(segments)}개 세그먼트", flush=True)

    logger.info("[STT] /transcribe-file 완료 (%.1f초, %d 세그먼트)", time.monotonic() - t0, len(segments))
    return TranscribeFileResponse(
        segments=[SegmentResponse(**dataclasses.asdict(seg)) for seg in segments],
        total_duration_ms=total_duration_ms,
    )


async def _try_whisperx_batch(request: TranscribeFileRequest, audio_bytes: bytes):
    """WhisperX 배치 처리를 시도한다. 성공 시 세그먼트 리스트, 실패 시 None 반환."""
    try:
        from app.diarization.whisperx_processor import WhisperXBatchProcessor
    except ImportError:
        print("[transcribe-file] whisperx 미설치 — 폴백", flush=True)
        return None

    try:
        # WhisperX 프로세서 lazy load (app.state에 캐싱)
        processor = getattr(app.state, "whisperx_processor", None)
        if processor is None:
            processor = WhisperXBatchProcessor(
                device="cpu",
                compute_type="int8",
                hf_token=settings.HF_TOKEN,
            )
            await processor.load()
            app.state.whisperx_processor = processor

        segments = await processor.process_bytes(audio_bytes, languages=request.languages)
        return segments if segments else None
    except Exception as e:
        print(f"[transcribe-file] WhisperX 실패: {e} — 폴백", flush=True)
        return None


# _SAMPLE_RATE, _BYTES_PER_SAMPLE는 파일 상단에서 정의됨


async def _chunked_transcribe(
    adapter,
    audio_bytes: bytes,
    chunk_sec: int = 15,
    overlap_sec: int = 2,
    languages: list[str] | None = None,
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
        segments = await adapter.transcribe(chunk, languages=languages)

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

_CLI_LLM_PROVIDERS = CLI_LLM_PROVIDERS


def _find_env_file() -> str | None:
    """pydantic-settings와 동일한 순서로 .env 파일을 탐색한다."""
    from pathlib import Path
    for candidate in (".env", "../.env"):
        p = Path(candidate).resolve()
        if p.is_file():
            return str(p)
    return None


def _persist_env(**kwargs: str) -> None:
    """변경된 설정값을 .env 파일에 영구 저장한다."""
    env_path = _find_env_file()
    if not env_path:
        return
    try:
        from dotenv import set_key
        for key, value in kwargs.items():
            set_key(env_path, key, value)
    except Exception:
        pass  # .env 쓰기 실패는 런타임에 영향 없음


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


def _mask_token(token: str) -> str:
    """토큰을 마스킹한다 (앞 4자 + *** + 뒤 4자)."""
    if not token or len(token) <= 8:
        return "****" if token else ""
    return f"{token[:4]}{'*' * (len(token) - 8)}{token[-4:]}"


def _llm_token_and_url(provider: str) -> tuple[str, str]:
    """프로바이더에 따른 마스킹된 토큰과 base_url을 반환한다."""
    if provider in _CLI_LLM_PROVIDERS:
        return "", ""
    if provider == "openai":
        return _mask_token(settings.OPENAI_API_KEY), settings.OPENAI_BASE_URL
    return _mask_token(settings.ANTHROPIC_AUTH_TOKEN), settings.ANTHROPIC_BASE_URL


@app.get("/settings/llm")
async def get_llm_settings() -> dict:
    """현재 LLM 설정을 반환한다."""
    provider = settings.LLM_PROVIDER
    token_masked, base_url = _llm_token_and_url(provider)
    return {
        "provider": provider,
        "auth_token_masked": token_masked,
        "anthropic_token_masked": _mask_token(settings.ANTHROPIC_AUTH_TOKEN),
        "openai_token_masked": _mask_token(settings.OPENAI_API_KEY),
        "base_url": base_url,
        "model": settings.LLM_MODEL,
        "max_input_tokens": settings.LLM_MAX_INPUT_TOKENS,
        "max_output_tokens": settings.LLM_MAX_OUTPUT_TOKENS,
    }


@app.put("/settings/llm")
async def update_llm_settings(request: UpdateLlmSettingsRequest) -> dict:
    """LLM 설정을 런타임에 변경하고 클라이언트를 재생성한다."""
    if request.provider is not None:
        settings.LLM_PROVIDER = request.provider
    if request.auth_token is not None and settings.LLM_PROVIDER not in _CLI_LLM_PROVIDERS:
        if settings.LLM_PROVIDER == "openai":
            settings.OPENAI_API_KEY = request.auth_token
        else:
            settings.ANTHROPIC_AUTH_TOKEN = request.auth_token
    if request.base_url is not None and settings.LLM_PROVIDER not in _CLI_LLM_PROVIDERS:
        if settings.LLM_PROVIDER == "openai":
            settings.OPENAI_BASE_URL = request.base_url
        else:
            settings.ANTHROPIC_BASE_URL = request.base_url
    if request.model is not None:
        settings.LLM_MODEL = request.model
    if request.max_input_tokens is not None:
        settings.LLM_MAX_INPUT_TOKENS = request.max_input_tokens
    if request.max_output_tokens is not None:
        settings.LLM_MAX_OUTPUT_TOKENS = request.max_output_tokens

    # LLM 클라이언트 재생성
    app.state.summarizer = LLMSummarizer()

    # .env 파일에 영구 저장
    env_updates: dict[str, str] = {
        "LLM_PROVIDER": settings.LLM_PROVIDER,
        "LLM_MODEL": settings.LLM_MODEL,
        "LLM_MAX_INPUT_TOKENS": str(settings.LLM_MAX_INPUT_TOKENS),
        "LLM_MAX_OUTPUT_TOKENS": str(settings.LLM_MAX_OUTPUT_TOKENS),
    }
    if settings.LLM_PROVIDER == "openai":
        if request.auth_token is not None:
            env_updates["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
        env_updates["OPENAI_BASE_URL"] = settings.OPENAI_BASE_URL
    elif settings.LLM_PROVIDER not in _CLI_LLM_PROVIDERS:
        if request.auth_token is not None:
            env_updates["ANTHROPIC_AUTH_TOKEN"] = settings.ANTHROPIC_AUTH_TOKEN
        env_updates["ANTHROPIC_BASE_URL"] = settings.ANTHROPIC_BASE_URL
    _persist_env(**env_updates)

    provider = settings.LLM_PROVIDER
    token_masked, base_url = _llm_token_and_url(provider)
    return {
        "provider": provider,
        "auth_token_masked": token_masked,
        "base_url": base_url,
        "model": settings.LLM_MODEL,
        "max_input_tokens": settings.LLM_MAX_INPUT_TOKENS,
        "max_output_tokens": settings.LLM_MAX_OUTPUT_TOKENS,
    }


class TestLlmRequest(BaseModel):
    """POST /settings/llm/test 요청 스키마."""
    provider: str  # "anthropic", "openai", "claude_cli", "gemini_cli", "codex_cli"
    auth_token: str | None = None
    base_url: str | None = None
    model: str


@app.post("/settings/llm/test")
async def test_llm_connection(request: TestLlmRequest) -> dict:
    """LLM 연결을 테스트한다. 격리된 설정 복사본을 사용하여 글로벌 상태를 변경하지 않는다."""
    from app.config import Settings
    test_settings = settings.model_copy()
    test_settings.LLM_PROVIDER = request.provider
    test_settings.LLM_MODEL = request.model
    if request.provider not in _CLI_LLM_PROVIDERS:
        if request.provider == "openai":
            if request.auth_token:
                test_settings.OPENAI_API_KEY = request.auth_token
            if request.base_url is not None:
                test_settings.OPENAI_BASE_URL = request.base_url
        else:
            if request.auth_token:
                test_settings.ANTHROPIC_AUTH_TOKEN = request.auth_token
            if request.base_url is not None:
                test_settings.ANTHROPIC_BASE_URL = request.base_url

    try:
        test_summarizer = LLMSummarizer(settings_override=test_settings)
        await test_summarizer._call_llm_raw("You are a test.", "Hi", max_tokens=5)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


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

    # 토큰 변경 시 기존 파이프라인 초기화 (다음 요청에서 lazy load)
    app.state.diarizer_pipeline = None

    _persist_env(HF_TOKEN=settings.HF_TOKEN)

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
    t0 = time.monotonic()
    logger.info("[LLM] /summarize 요청 (model=%s, type=%s, transcripts=%d건)", settings.LLM_MODEL, request.type, len(request.transcripts))
    summarizer: LLMSummarizer = app.state.summarizer
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


class RefineNotesRequest(BaseModel):
    """POST /refine-notes 요청 스키마."""
    current_notes: str = ""
    transcripts: list[TranscriptItem]
    meeting_title: str = ""
    meeting_type: str = "general"
    sections_prompt: str | None = None


class RefineNotesResponse(BaseModel):
    """POST /refine-notes 응답 스키마."""
    notes_markdown: str


@app.post("/refine-notes", response_model=RefineNotesResponse)
async def refine_notes(request: RefineNotesRequest) -> RefineNotesResponse:
    """회의록 자동 정제 엔드포인트.

    현재 회의록(Markdown) + 새 자막을 받아 오타 교정, 구조화, 통합된 회의록을 반환한다.
    동일 회의에 대한 동시 요청은 순차 처리된다.
    """
    # 회의별 락 — 동시 LLM 호출 방지
    lock_key = request.meeting_title or "_default"
    locks = app.state.refine_locks
    if lock_key not in locks:
        locks[lock_key] = asyncio.Lock()
    lock = locks[lock_key]

    if lock.locked():
        logger.info("[LLM] /refine-notes 대기 (이전 요청 처리 중: %s)", lock_key)

    async with lock:
        t0 = time.monotonic()
        logger.info("[LLM] /refine-notes 요청 (model=%s, title=%s, transcripts=%d건, notes=%d자)",
                    settings.LLM_MODEL, request.meeting_title, len(request.transcripts), len(request.current_notes))
        summarizer: LLMSummarizer = app.state.summarizer
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


class BuildPromptRequest(BaseModel):
    """POST /build-prompt 요청 스키마."""
    current_notes: str = ""
    transcripts: list[TranscriptItem]
    meeting_title: str = ""
    sections_prompt: str | None = None


class BuildPromptResponse(BaseModel):
    """POST /build-prompt 응답 스키마."""
    prompt_text: str


@app.post("/build-prompt", response_model=BuildPromptResponse)
async def build_prompt(request: BuildPromptRequest) -> BuildPromptResponse:
    """LLM 호출 없이 완성된 프롬프트 텍스트를 반환한다.

    사용자가 외부 LLM(ChatGPT, Claude 웹 등)에 직접 붙여넣을 수 있는
    자기 완결형 프롬프트를 조립한다.
    """
    summarizer: LLMSummarizer = app.state.summarizer
    transcripts_dicts = [item.model_dump() for item in request.transcripts]
    result = summarizer.build_prompt(
        current_notes=request.current_notes,
        transcripts=transcripts_dicts,
        meeting_title=request.meeting_title,
        sections_prompt=request.sections_prompt,
    )
    return BuildPromptResponse(prompt_text=result)


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
    t0 = time.monotonic()
    logger.info("[LLM] /feedback-notes 요청 (model=%s, title=%s, feedback=%d자)", settings.LLM_MODEL, request.meeting_title, len(request.feedback))
    summarizer: LLMSummarizer = app.state.summarizer
    result = await summarizer.apply_feedback(
        current_notes=request.current_notes,
        feedback=request.feedback,
        meeting_title=request.meeting_title,
    )
    logger.info("[LLM] /feedback-notes 완료 (%.1f초, 출력=%d자)", time.monotonic() - t0, len(result))
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
