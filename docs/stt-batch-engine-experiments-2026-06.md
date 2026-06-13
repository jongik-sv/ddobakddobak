# 배치 STT 엔진 실험 결과 및 정리 (2026-06-13)

브랜치 `feat/speaker-diarization`. 회의 152(오디오 2875초 = 47.9분, 한국어, 5화자)로
배치(파일 재전사) STT 엔진들을 실제 파이프라인에서 측정. 화자분리(speakrs)·문장분리 포함.

> ⚠️ 절대 속도는 MacBook Air(팬리스) **발열 throttle** 영향을 받음. 연속 측정 시 2~4배까지
> 느려짐. 아래 표는 가능한 한 냉각 상태 값이나, **속도 절대치보다 엔진 간 상대 비교·품질**에 무게.

---

## 1. 측정 결과 (회의 152, 47.9분, 풀 파이프라인)

| 엔진 | 총시간 | STT | 속도 | 세그먼트 | 화자 | 스킵 | 품질 |
|------|-------|-----|------|---------|------|------|------|
| **gguf f16** (whisper.cpp) | 299s | 279s | 10.3x | **657** | 5 | 0 | 깨끗 |
| **beam 8bit** (MLX) | **227s** | 204s | **14.1x** | 614 | 5 | 1 | 깨끗 |
| beam 16bit (MLX) | 456s | 422s | 6.8x | 625 | 5 | 0 | 깨끗 |
| Qwen3-ASR 8bit | 353s | 327s | 8.8x | 771 | — | — | **화자/문장 뭉갬** |

### 10분 클립 단독 측정 (품질 비교용, 속도는 throttle라 무시)

| 엔진 | 세그먼트 | 품질 |
|------|---------|------|
| beam f16 | 497 | 깨끗 |
| beam 8bit | 486 | 깨끗 |
| MLX 8bit greedy | 多 | **환각** ("랩"←LPR, "안개가 되어서") |
| MLX f16 greedy | 多 | **환각** ("Tage","andar" 외국어) |
| gguf q8 greedy | 470 | **환각** ("랩","에펠 두 개") |
| gguf q8 beam | 436 | **환각 + 반복벽** ("안만놔오"×7) |

---

## 2. 엔진별 특징

### MLX whisper greedy (8bit / 16bit) — `mlx_whisper_turbo_8bit`, `mlx_whisper_turbo_f16`
- MLX(mlx-audio)는 **greedy 디코딩 전용**. 애매한 발음에서 환각("랩"←LPR, 외국어 단어).
- 양자화 문제 아님 — f16도 동일 환각. **greedy 자체의 약점**.
- 속도는 빠름(~20x). **품질 부적합 → 폐기 권장**.

### MLX beam (Lightning vendored) — `mlx_whisper_turbo_beam`(f16), `mlx_whisper_turbo_beam_8bit`(8bit)
- [Lightning-SimulWhisper](https://github.com/altalt-org/Lightning-SimulWhisper)의 `simul_whisper/mlx_whisper/`를
  `sidecar/app/stt/vendor/lw_whisper/`로 vendor. 진짜 `BeamSearchDecoder` 포함.
- **beam search가 greedy 환각을 제거** → 깨끗. f16/8bit 품질 동급(beam이 양자화 손실 보정).
- **beam 8bit = 8bit이 f16보다 ~2배 빠르고 품질 동급** (227s vs 456s). 모델 863MB vs 1.6GB.
- 함정/주의:
  - mlx **0.31.2 필수** (0.31.1은 beam에서 `argmax of empty sequence` 버그). pyproject bump 완료.
  - 8bit repo 가중치 파일명 = `model.safetensors`(weights.* 아님) → vendored `load_models.py` 패치 필요(완료).
  - **빈-시퀀스 엣지케이스 잔존**: 특정 무음/짧은 청크가 `argmax of empty sequence` 유발(152의 56초 지점).
    → `_chunked_transcribe`에 **청크 단위 try/except** 추가(완료) → 그 30초만 스킵하고 완주(전체 실패 방지).

### gguf f16 (whisper.cpp / pywhispercpp) — `whisper_cpp`
- 원래 있던 ggml `large-v3-turbo` f16 (1.5GB). greedy 기본인데 **whisper.cpp의 entropy_thold가
  반복을 원천 차단** → MLX greedy와 달리 환각 없이 깨끗.
- **세그먼트 657개 = 가장 촘촘**(문장 분리 제일 세밀, 읽기·화자정렬 유리).
- **스킵 0 = 가장 안정**(beam의 빈-시퀀스 문제 없음).
- 속도 10.3x — beam 8bit(14x)보단 느리나 beam f16(6.8x)보단 빠름.

### gguf q8 (whisper.cpp 8bit 양자화) — `large-v3-turbo-q8_0`
- 빠름(~14x)이나 **greedy·beam 둘 다 환각 + 반복벽**("안만놔오"×7). whisper.cpp q8 양자화가
  한국어 애매발음에 손실 큼. beam도 못 살림. **폐기 확정**.
- 참고: pywhispercpp beam_size는 nested struct(`_params.beam_search`)라 setattr 불가, strategy=1만 적용됨.

### Qwen3-ASR 1.7B 8bit — `qwen3_asr_8bit`
- 자기회귀 LLM-ASR. **청크당 1세그먼트(30초 블록)** → 문장/화자 분리가 거침.
  화자분리 정렬·타임스탬프 네비게이션에 **부적합**.
- "예전 배치 느림"의 정체 = **단일콜 초선형**(60s=19.6x→600s=8.4x). 현재는 `AUDIO_FILE_CHUNK_SEC=30`
  청크 분할로 12x 일정. 단 세그먼트 입도 문제는 남음.
- 속도·텍스트정확도는 양호하나 **화자분리 용도엔 부적합 → 배치 비권장**(실시간 STT 기본 엔진으로는 유지).

---

## 3. ★ 추천 조합 (단순화안)

현재 배치 셀렉터 6개(8bit / 16bit / Beam 16bit / Beam 8bit / gguf f16 / Qwen)는 과다.
**2개로 단순화 권장:**

| 옵션 | 엔진 | 용도 |
|------|------|------|
| **기본 (균형/안정)** | **gguf f16** (`whisper_cpp`) | 가장 촘촘(657)·스킵0·환각없음·10x. 화자분리 정렬 최적 |
| **고속** | **beam 8bit** (`mlx_whisper_turbo_beam_8bit`) | 14x로 가장 빠름·품질 동급. 단 드물게 1청크 스킵 |

**폐기 권장:**
- `mlx_whisper_turbo_8bit`, `mlx_whisper_turbo_f16` (greedy 환각)
- `mlx_whisper_turbo_beam` (16bit) — beam 8bit이 더 빠르고 품질 동급, 잉여
- `qwen3_asr_8bit` (배치 한정 — 화자분리 부적합. 실시간 엔진으로는 유지)
- gguf q8 (셀렉터에 없음, 추가하지 말 것 — 환각)

**한 줄 요약:** 품질·안정 = **gguf f16**, 속도 = **beam 8bit**. 둘만 남기면 충분.

---

## 4. 실시간 STT 라벨 회귀 (main 대비 차이) — 수정됨

### 증상
설정 화면 **실시간 "STT 모델"** 셀렉터의 Qwen 항목이
`Qwen3-ASR 1.7B 8bit (빠름, 30초 단위)`로 표시됨(원래 `Qwen3-ASR 1.7B (8bit 양자화)`).

### 원인
- 모델은 **완전히 동일**(`qwen3_asr_8bit` = `mlx-community/Qwen3-ASR-1.7B-8bit`). **라벨만** 바뀜.
- `frontend/src/config.ts`의 `ENGINE_LABELS`는 `config.yaml`의 `stt_engines`(실시간 셀렉터 라벨 출처) +
  배치용 수동 override로 구성됨. 배치 셀렉터용으로 추가한
  `qwen3_asr_8bit: 'Qwen3-ASR 1.7B 8bit (빠름, 30초 단위)'` override가
  **공유 맵이라 실시간 셀렉터까지 오염**시킴(main에는 이 override 자체가 없음).

### 수정
- config.ts에서 `qwen3_asr_8bit` override **제거** → 실시간·배치 모두 config.yaml 라벨
  `"Qwen3-ASR 1.7B (8bit 양자화)"` 사용(main과 동일 복원).
- 교훈: `ENGINE_LABELS`는 실시간/배치 공유 맵 → 배치 전용 문구를 여기 넣지 말 것.
  배치 한정 라벨이 필요하면 SttSettingsPanel 전용 맵으로 분리.

---

## 5. (참고) 요약 LLM 측정 — 배치와 별개

같은 회의(657세그·18k자) 회의록 생성 LLM 비교:

| 프로바이더/모델 | 경로 | 결과 |
|----------------|------|------|
| **anthropic / glm-5** | API | **~99s 성공** (27s + 72s) — 가장 빠름·안정 |
| claude_cli / sonnet | `claude -p` 서브프로세스 | 180s선 실패 → **360s 상향 후 ~178s 성공**(67s+111s, 변동 큼) |
| codex_cli / gpt-5.5 | `codex exec` 서브프로세스 | **360s도 초과 실패** (가장 느림) |

- CLI 프로바이더(claude_cli/codex_cli)는 서브프로세스 오버헤드로 느리고 **지연 변동 큼**(sonnet 2차 호출이
  같은 입력에 110s~180s+ 오락가락 → 180s 타임아웃 빈발).
- **GLM-5(API 직결)가 가장 빠르고 안정**(~99s) → 요약 기본 LLM 후보.
- `CLI_TIMEOUT` 180→360s(env `LLM_CLI_TIMEOUT`) 상향 → claude_cli/sonnet은 살아남(178s), codex는 그래도 초과.

---

## 6. 변경 파일 (전부 미커밋, feat/speaker-diarization)

- `sidecar/app/stt/vendor/lw_whisper/` — Lightning beam 모듈 vendor (+ load_models.py model.safetensors 패치)
- `sidecar/app/stt/mlx_whisper_beam_adapter.py` — MLXWhisperBeamAdapter (beam f16/8bit)
- `sidecar/app/stt/factory.py` — `_MLX_BEAM_MODEL_IDS`, whisper_cpp/qwen 배치 엔진
- `sidecar/app/routers/settings.py` — `_AVAILABLE_FILE_ENGINES` 6엔진
- `sidecar/app/routers/stt.py` — `_chunked_transcribe` 청크 try/except, transcribe-file 응답 engine
- `sidecar/app/schemas.py`, `app/config.py` — engine 필드/주석
- `sidecar/pyproject.toml` — mlx 0.31.2, tiktoken, more-itertools
- `backend/db/migrate/*_add_stt_engine_to_meetings.rb` — `meetings.stt_engine` 컬럼
- `backend/app/jobs/file_transcription_job.rb` — stt_engine 기록
- `backend/app/controllers/concerns/meeting_serializable.rb` — stt_engine 노출
- `backend/app/controllers/api/v1/settings_controller.rb` — fallback 목록 6엔진
- `backend/app/services/llm_service.rb` — CLI_TIMEOUT 360s
- `frontend/src/config.ts` — 배치 라벨(+ qwen override 제거), `frontend/src/api/meetings.ts` — stt_engine 타입
- `frontend/src/components/meeting/EditMeetingDialog.tsx` — 회의정보 STT 모델 표시
