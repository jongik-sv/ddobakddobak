"""실시간/배치 STT 및 파일 변환 라우터."""
import base64
import dataclasses
import logging
import os
import time

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.audio_constants import BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE, SAMPLE_RATE as _SAMPLE_RATE
from app.config import settings
from app.schemas import (
    SegmentResponse,
    TranscribeFileRequest,
    TranscribeFileResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from app.stt import lang_utils

logger = logging.getLogger(__name__)

# 오디오 최소 청크 길이 — settings.MIN_CHUNK_SEC(settings.yaml/config.yaml)에서 로드됨
MIN_CHUNK_SEC = settings.MIN_CHUNK_SEC
MIN_CHUNK_BYTES = int(MIN_CHUNK_SEC * _SAMPLE_RATE * _BYTES_PER_SAMPLE)

router = APIRouter()


def _segments_to_response(segments) -> list[SegmentResponse]:
    return [SegmentResponse(**dataclasses.asdict(seg)) for seg in segments]


def _resolve_diar_engine() -> str:
    """배치 화자분리 엔진 결정. speakrs(CoreML) 바이너리가 있으면 speakrs, 없으면 비활성("")."""
    from app.diarization.speakrs_runner import is_available
    return "speakrs" if is_available() else ""


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest, http_request: Request) -> TranscribeResponse:
    """배치 STT 엔드포인트.

    base64 인코딩된 PCM 16kHz mono Int16 오디오를 받아 텍스트로 변환한다.

    Args:
        request: { audio: base64_string, meeting_id: int | None }

    Returns:
        { segments: [TranscriptSegment, ...] }
    """
    t0 = time.monotonic()
    adapter = http_request.app.state.stt_adapter
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

    # 실시간(청크) 경로는 화자분리를 하지 않는다 — 화자 라벨 없이 세그먼트만 반환.
    # 화자분리는 배치(/transcribe-file)에서 speakrs로만 수행된다.
    langs = request.languages
    mode = request.mode
    async with http_request.app.state.gpu_lock:
        segments = await adapter.transcribe(audio_bytes, languages=langs, mode=mode)
        if mode == "multi":
            segments = lang_utils.filter_segments(segments, langs)

    logger.info("[STT] /transcribe 완료 (%.1f초, %d 세그먼트)", time.monotonic() - t0, len(segments))
    return TranscribeResponse(
        segments=_segments_to_response(segments)
    )


@router.post("/transcribe-file", response_model=TranscribeFileResponse)
async def transcribe_file(request: TranscribeFileRequest, http_request: Request) -> TranscribeFileResponse:
    """오디오 파일 전체 STT + 화자분리 + 한국어 문장 분리 엔드포인트.

    Backend가 ffmpeg로 변환한 raw PCM 16kHz mono Int16 파일 경로를 받아
    전체 파일을 정교하게 변환한다.
    """
    t0 = time.monotonic()
    logger.info("[STT] /transcribe-file 요청 (engine=%s, file=%s)", settings.STT_ENGINE, request.file_path)

    adapter = http_request.app.state.stt_adapter
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
    logger.info(f"[transcribe-file] 파일 크기={len(audio_bytes)} bytes, 길이={total_duration_ms}ms")

    # 2. STT 실행 — 배치 엔진은 settings.STT_FILE_ENGINE로 선택 (실시간 엔진과 분리)
    timings: dict[str, float] = {}
    from app.stt.factory import (
        auto_select_engine,
        create_stt_adapter,
        resolve_file_engine,
    )
    file_engine = resolve_file_engine(settings.STT_FILE_ENGINE)
    realtime_engine = settings.STT_ENGINE
    if realtime_engine == "auto":
        realtime_engine = auto_select_engine()

    file_adapter = adapter
    _file_adapter_loaded_here = False
    _t_load = time.monotonic()
    if file_engine != realtime_engine:
        logger.info("[transcribe-file] 배치 STT 엔진 로드: %s (실시간=%s)", file_engine, realtime_engine)
        file_adapter = create_stt_adapter(file_engine)
        await file_adapter.load_model()
        _file_adapter_loaded_here = True
    timings["model_load"] = time.monotonic() - _t_load

    chunk_sec = request.file_chunk_sec
    _t_stt = time.monotonic()
    try:
        if chunk_sec > 0:
            # 청크 분할 모드: 지정된 시간 단위로 분할하여 처리 (다국어 감지에 유리)
            logger.info(f"[transcribe-file] 청크 분할 모드 ({chunk_sec}초)")
            segments = await _chunked_transcribe(
                file_adapter, audio_bytes,
                chunk_sec=chunk_sec, overlap_sec=2,
                languages=request.languages,
                mode=request.mode,
            )
        else:
            # 분할 없이 Whisper 내부 윈도우(~30초)로 처리
            segments = await file_adapter.transcribe(
                audio_bytes, languages=request.languages, mode=request.mode
            )
    finally:
        if _file_adapter_loaded_here:
            del file_adapter
            import gc; gc.collect()
    timings["stt"] = time.monotonic() - _t_stt

    logger.info(f"[transcribe-file] STT 세그먼트 {len(segments)}개")

    # multi 모드: 감지언어가 허용 목록 밖인 세그먼트 제거
    if request.mode == "multi":
        segments = lang_utils.filter_segments(segments, request.languages)
        logger.info(f"[transcribe-file] 언어 필터 후 {len(segments)}개")

    # 3. 화자 분리 — speakrs(CoreML, 별도 프로세스) 단일 엔진
    _t_diar = time.monotonic()
    diar_cfg = request.diarization_config or {}
    enable_diarization = diar_cfg.get("enable", False)
    ahc_threshold = diar_cfg.get("ahc_threshold")
    if enable_diarization and segments:
        diar_engine = _resolve_diar_engine()
        try:
            if diar_engine == "speakrs":
                # speakrs는 별도 프로세스(CoreML)라 Metal 경쟁 없음 → gpu_lock 불필요
                from app.diarization.batch_processor import batch_diarize_speakrs
                segments = await batch_diarize_speakrs(
                    audio_bytes, segments, meeting_id=request.meeting_id,
                    ahc_threshold=ahc_threshold,
                )
                logger.info("[transcribe-file] 배치 화자 분리 완료 (speakrs)")
            else:
                logger.info("[transcribe-file] 화자 분리 엔진 사용 불가(speakrs 미설치) — 라벨 없이 진행")
        except Exception as e:
            logger.exception(f"[transcribe-file] 화자 분리 실패 (무시): {e}")
    else:
        logger.info(f"[transcribe-file] 화자 분리 스킵")
    timings["diarization"] = time.monotonic() - _t_diar

    # 4. 한국어 문장 분리 후처리
    _t_seg = time.monotonic()
    from app.stt.sentence_segmenter import segment_korean_sentences
    segments = segment_korean_sentences(segments)
    timings["sentence_split"] = time.monotonic() - _t_seg
    logger.info(f"[transcribe-file] 문장 분리 후 {len(segments)}개 세그먼트")

    _total = time.monotonic() - t0
    audio_sec = total_duration_ms / 1000.0
    logger.info(
        "[transcribe-file][timing] model_load=%.1fs stt=%.1fs diar=%.1fs "
        "sentence_split=%.1fs total=%.1fs | audio=%.1fs speed=%.2fx",
        timings["model_load"], timings["stt"], timings["diarization"],
        timings["sentence_split"], _total, audio_sec,
        (audio_sec / _total) if _total > 0 else 0.0,
    )
    logger.info("[STT] /transcribe-file 완료 (%.1f초, %d 세그먼트)", _total, len(segments))
    return TranscribeFileResponse(
        segments=_segments_to_response(segments),
        total_duration_ms=total_duration_ms,
        engine=file_engine,
    )


async def _chunked_transcribe(
    adapter,
    audio_bytes: bytes,
    chunk_sec: int = 15,
    overlap_sec: int = 2,
    languages: list[str] | None = None,
    mode: str = "single",
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
        try:
            segments = await adapter.transcribe(chunk, languages=languages, mode=mode)
        except Exception as e:
            # 한 청크 실패(예: beam 디코더 빈 시퀀스 엣지케이스)가 전체 파일 전사를
            # 죽이지 않도록 해당 청크만 스킵한다. 30s 공백은 전체 실패보다 낫다.
            logger.warning(
                "[transcribe-file] 청크 스킵 (offset=%dms): %s: %s",
                offset_ms, type(e).__name__, e,
            )
            offset += step_bytes
            continue

        for seg in segments:
            seg.started_at_ms += offset_ms
            seg.ended_at_ms += offset_ms
            all_segments.append(seg)

        chunk_idx += 1
        if chunk_idx % 10 == 0:
            logger.info(f"[transcribe-file] 청크 {chunk_idx} 처리 완료 ({offset_ms}ms / {int(total_len / bytes_per_sec * 1000)}ms)")

        offset += step_bytes

    logger.info(f"[transcribe-file] 총 {chunk_idx}개 청크 처리 완료")
    return all_segments


@router.websocket("/ws/transcribe")
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
    adapter = websocket.app.state.stt_adapter
    seq = 0

    try:
        while True:
            audio_bytes = await websocket.receive_bytes()
            segments = await adapter.transcribe(audio_bytes)

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
