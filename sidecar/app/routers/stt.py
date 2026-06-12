"""실시간/배치 STT 및 파일 변환 라우터."""
import base64
import dataclasses
import logging
import os
import time

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.audio_constants import BYTES_PER_SAMPLE as _BYTES_PER_SAMPLE, SAMPLE_RATE as _SAMPLE_RATE
from app.config import settings
from app.deps import ensure_diarizer_pipeline, get_meeting_diarizer
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

    # 화자분리 요청 시 파이프라인 lazy load
    if request.diarization_config and request.diarization_config.get("enable"):
        await ensure_diarizer_pipeline(http_request.app)
    # Metal GPU 동시 접근 방지 — STT(MLX)와 화자분리(MPS) 직렬화
    diarizer = get_meeting_diarizer(http_request.app, request.meeting_id, request.diarization_config)
    langs = request.languages
    mode = request.mode
    async with http_request.app.state.gpu_lock:
        segments = await adapter.transcribe(audio_bytes, languages=langs, mode=mode)
        if mode == "multi":
            segments = lang_utils.filter_segments(segments, langs)
        if diarizer and segments:
            try:
                diarization_result = await diarizer.diarize(audio_bytes, offset_ms=request.offset_ms)
                if diarization_result:
                    logger.info(f"[diarizer] result={diarization_result}")
                    segments = diarizer.merge_with_segments(segments, diarization_result)
            except Exception as e:
                logger.exception(f"[diarizer] ERROR: {e}")

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

    # 2. STT 실행 — 파일 변환은 항상 Whisper 사용
    from app.stt.whisper_adapter import WhisperAdapter
    file_adapter = adapter
    _whisper_loaded_here = False
    if not isinstance(adapter, WhisperAdapter):
        logger.info("[transcribe-file] Whisper 엔진으로 전환하여 파일 처리")
        file_adapter = WhisperAdapter()
        await file_adapter.load_model()
        _whisper_loaded_here = True

    chunk_sec = request.file_chunk_sec
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
        if _whisper_loaded_here:
            del file_adapter
            import gc; gc.collect()

    logger.info(f"[transcribe-file] STT 세그먼트 {len(segments)}개")

    # multi 모드: 감지언어가 허용 목록 밖인 세그먼트 제거
    if request.mode == "multi":
        segments = lang_utils.filter_segments(segments, request.languages)
        logger.info(f"[transcribe-file] 언어 필터 후 {len(segments)}개")

    # 3. 화자 분리 — community-1 전체 오디오 배치 (MPS, gpu_lock으로 MLX와 직렬화)
    enable_diarization = (request.diarization_config or {}).get("enable", False)
    if enable_diarization and segments:
        await ensure_diarizer_pipeline(http_request.app)
        pipeline = getattr(http_request.app.state, "diarizer_pipeline", None)
        if pipeline:
            try:
                from app.diarization.batch_processor import batch_diarize
                async with http_request.app.state.gpu_lock:
                    segments = await batch_diarize(
                        audio_bytes, pipeline, segments,
                        meeting_id=request.meeting_id,
                    )
                # 배치 결과가 SpeakerDB를 다시 썼으므로 메모리에 캐시된 실시간
                # diarizer가 있으면 무효화 (이후 접근 시 파일에서 재로드)
                diarizers = getattr(http_request.app.state, "meeting_diarizers", None)
                if diarizers is not None and request.meeting_id is not None:
                    diarizers.pop(request.meeting_id, None)
                logger.info(f"[transcribe-file] 배치 화자 분리 완료")
            except Exception as e:
                logger.exception(f"[transcribe-file] 화자 분리 실패 (무시): {e}")
    else:
        logger.info(f"[transcribe-file] 화자 분리 스킵")

    # 4. 한국어 문장 분리 후처리
    from app.stt.sentence_segmenter import segment_korean_sentences
    segments = segment_korean_sentences(segments)
    logger.info(f"[transcribe-file] 문장 분리 후 {len(segments)}개 세그먼트")

    logger.info("[STT] /transcribe-file 완료 (%.1f초, %d 세그먼트)", time.monotonic() - t0, len(segments))
    return TranscribeFileResponse(
        segments=_segments_to_response(segments),
        total_duration_ms=total_duration_ms,
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
        segments = await adapter.transcribe(chunk, languages=languages, mode=mode)

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
