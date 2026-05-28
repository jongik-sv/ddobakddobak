# Sidecar 리팩토링 분석

> 범위: 코드 분석 + 개선안만. 코드 변경 없음.
> 대상: `/Users/jji/project/ddobakddobak/sidecar`

## 1. 현재 구조

```
sidecar/app/
  main.py                    1047줄  ← god 파일 (FastAPI 앱 + 전 엔드포인트 + 스키마 + 헬퍼)
  config.py                   113줄  pydantic-settings + settings.yaml 로더
  llm/summarizer.py           588줄  LLM 요약/정제/액션아이템
  diarization/
    speaker.py                420줄  SpeakerDiarizer (회의별 화자 DB)
    whisperx_processor.py     242줄  WhisperX 배치 처리
    batch_processor.py        106줄  pyannote 배치 폴백
  stt/
    qwen3_transformers_adapter.py 229줄
    sentence_segmenter.py     177줄
    faster_whisper_adapter.py 148줄
    whisper_adapter.py        142줄
    qwen3_adapter.py          122줄
    factory.py                103줄
    base.py                    83줄
    mock_adapter.py            57줄
    lang_utils.py              56줄
    audio_utils.py             46줄
```

핵심 문제는 **`main.py` 1047줄**에 집중. stt/diarization 어댑터 계층은 이미 잘 분리돼 있음.

## 2. main.py 문제점

한 파일에 6개 관심사가 뒤섞임:

| 관심사 | 내용 | 줄 범위(대략) |
|---|---|---|
| 부트스트랩 | multiprocessing/torch sharing 설정 | 1–27 |
| 설정 로더 | `_load_min_chunk_sec`, MIN_CHUNK 상수 | 38–61 |
| 엔진 탐지 | `_is_model_cached`, `_detect_available_engines`, `AVAILABLE_STT_ENGINES` | 76–135 |
| Pydantic 스키마 | 20+ 모델이 엔드포인트 사이사이 흩어짐 | 전역 |
| STT 엔드포인트 | `/transcribe`, `/transcribe-file`, `/ws/transcribe` + 헬퍼 | 339–605 |
| LLM 엔드포인트 | `/summarize`, `/refine-notes`, `/build-prompt`, `/feedback-notes`, `/summarize/action-items` | 894–1047 |
| Settings 엔드포인트 | `/settings/stt-engine`, `/settings/llm`, `/settings/hf` | 240–289, 733–853 |
| Speaker 엔드포인트 | `/speakers`, `/speakers/{id}` | 861–891 |
| 헬퍼 | `_persist_env`, `_mask_token`, `_get_summarizer`, `_get_meeting_diarizer`, `_ensure_diarizer_pipeline` | 분산 |

구체적 냄새:
- **스키마 위치 산만**: `TranscribeRequest`(138), `SummarizeRequest`(648), `RefineNotesRequest`(923) 등이 각 엔드포인트 직전에 흩어져 전체 스키마 파악 불가.
- **죽은 주석**: 675–677줄 "LLM 요약 엔드포인트", "화자 관리 엔드포인트" 헤더가 실제 코드 위치와 안 맞음(엔드포인트는 한참 아래).
- **print/logger 혼용**: main.py에 `print(..., flush=True)` 16곳 + `logger.*` 12곳. 디버그 print가 운영 로그에 섞임.
- **함수 내부 import 남발**: `_load_min_chunk_sec`, `transcribe_file`, `_get_meeting_diarizer` 등에서 함수 본문 import. 일부는 의도적 lazy(무거운 ML 패키지)지만, `yaml`/`urllib.parse`/`Path` 같은 가벼운 것도 함수 안에 있음.
- **모듈 레벨 `app` 전역 의존**: 모든 헬퍼가 `app.state.X`를 직접 참조 → 라우터 분리 시 의존성 주입으로 정리 필요.

## 3. 제안 구조 (라우터 분리)

```
sidecar/app/
  main.py            # FastAPI(), lifespan, 라우터 include만 (~80줄)
  bootstrap.py       # multiprocessing/torch sharing (현 1–27줄)
  schemas.py         # Pydantic 모델 전부 한곳에
  engines.py         # _is_model_cached, _detect_available_engines, AVAILABLE_STT_ENGINES
  deps.py            # _get_summarizer, _get_meeting_diarizer, _ensure_diarizer_pipeline (Depends 형태)
  env_utils.py       # _find_env_file, _persist_env, _mask_token
  routers/
    health.py        # GET /health, /settings/stt-engine, PUT /settings/stt-engine
    stt.py           # /transcribe, /transcribe-file, /ws/transcribe + _chunked_transcribe, _try_whisperx_batch
    llm.py           # /summarize, /refine-notes, /build-prompt, /feedback-notes, /summarize/action-items
    settings.py      # GET/PUT /settings/llm, /settings/llm/test, GET/PUT /settings/hf
    speakers.py      # GET/PUT/DELETE /speakers
```

분리 효과: main.py 1047줄 → ~80줄. 도메인별 파일 80–250줄로 균등. 스키마 한곳 집결.

## 4. 깨지기 쉬운 지점 (이동 시 반드시 확인)

1. **Tauri 진입점 심볼 유지**: `frontend/src-tauri/src/lib.rs:687`이 `uv run uvicorn app.main:app`로 기동. `app.main:app` 객체는 **반드시 유지**. (`app-server.sh`, `dev.sh`도 동일 심볼 사용 추정 — 확인 필요.)
2. **`_load_min_chunk_sec` 경로 계산** (main.py:46–48): `Path(__file__).resolve().parent.parent.parent`로 sidecar 루트 추정. 파일을 하위 디렉터리(`routers/`)로 옮기면 깊이가 달라져 깨짐 → 안정 앵커 모듈로 빼거나 깊이 재계산.
3. **`config.py:11` 동일 패턴**: `parent.parent.parent`로 settings.yaml 탐색. config.py는 안 옮기면 안전.
4. **`AVAILABLE_STT_ENGINES`** (main.py:135): 모듈 import 시점 1회 계산. 라우터 여러 곳에서 참조하므로 `engines.py` 단일 모듈에 두고 import. 순환 import 주의.
5. **`_find_env_file` cwd 의존** (main.py:682): `Path(".env")` 상대 경로 → uvicorn 실행 cwd가 `sidecar/`임을 전제. 이동해도 동작 동일하나 명시적 앵커가 안전.
6. **`app.state` 접근**: 라우터에선 모듈 전역 `app` 대신 `request.app.state` 또는 `Depends(get_state)`로 전환 필요.

## 5. 코드 품질 개선안 (범위 확장 시)

- **print → logger 통일**: 운영 코드 디버그 print 정리 대상
  - `main.py` 16곳, `diarization/whisperx_processor.py` 11곳, `diarization/speaker.py` 9곳, `diarization/batch_processor.py` 2곳, `stt/factory.py` 1곳 (총 39곳)
  - 어댑터/요약기는 이미 `logger` 사용 → 일관성 위해 diarization 계층 정비 권장.
- **함수 내부 경량 import 정리**: `yaml`, `Path`, `urllib.parse` 등은 모듈 상단으로. 무거운 ML 패키지(torch/whisperx/pyannote)는 lazy 유지.
- **죽은/오배치 주석 제거**: main.py 675–677.

## 6. 더 큰 모듈 (선택적, 별도 작업 권장)

- `llm/summarizer.py` (588줄): 프롬프트 빌드 / LLM 호출 / 파싱이 한 클래스에 뭉쳐 있을 가능성. 프롬프트 템플릿 분리 후보.
- `diarization/speaker.py` (420줄): 임베딩 매칭 / DB 영속 / 이름 관리 분리 후보.
- 둘 다 main.py 분리와 **독립적**. 먼저 main.py만 끝내고 별도 PR 권장.

## 7. 권장 진행 순서

main.py 라우터 분리(범위 A) 채택 시 단계별:

1. `bootstrap.py` + `schemas.py` + `engines.py` + `env_utils.py` 추출 → `uv run pytest -x`
2. `deps.py` 추출 (의존성 주입 정리) → 테스트
3. 라우터 하나씩 분리 (health → speakers → settings → llm → stt 순, 의존성 적은 것부터) → 각 단계 테스트
4. main.py를 앱 조립 + 라우터 include만 남김 → 전체 `uv run pytest`

각 단계 후 **반드시** `cd sidecar && uv run pytest` 전수 실행 (test_health, test_ws_transcribe, test_summarizer 포함). import 깨짐 즉시 검출.

> 검증 원칙: 증분 체크 과신 금지, 단계마다 전수 테스트 (메모리 `feedback_full_compile_verify` 준수).
