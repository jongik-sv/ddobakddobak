# 화자분리 정확도 개선 + 화자별 문장 분리 — 설계

- 날짜: 2026-06-13
- 브랜치: `feat/diarization-accuracy`
- 리포: ddobakddobak (Rails backend + React frontend + Python STT sidecar)

## 목표

1. **Phase 1 — 화자분리 정확도 향상** (속도 희생 OK). 현재 화자 과소분할(under-segmentation): 두 사람이 한 화자 라벨로 병합됨.
2. **Phase 2 — 화자별 문장 분리** (이번엔 설계만, 구현은 Phase 1 측정 후). 여러 명 발화가 STT 세그먼트 1개로 뭉친 것을 화자별로 쪼개기.

순서: **Phase 1 먼저 → 회의 111 재전사로 측정 → 효과 확인 후 Phase 2.**

## 확정된 사실 (라이브 코드/소스/DB 직접 검증)

### 엔진 = speakrs 0.4.2 (Rust/CoreML, Apache-2.0)
- crate 소스: `~/.cargo/registry/src/index.crates.io-*/speakrs-0.4.2/`
- 모델 디렉토리 env: **`SPEAKRS_MODELS_DIR`** (HF 캐시 `models--avencera--speakrs-models`)
- README: "Matches pyannote accuracy", pyannote community-1 스타일 파이프라인(segmentation→embedding→AHC→VBx). CoreMl 7.1% DER @ 529x realtime.

### 현재 CLI 래퍼 (소스 디스크에 없음 — 신규 작성 대상)
- `sidecar/bin/speakrs-cli` (28MB Mach-O arm64). `usage: speakrs-cli <pcm_s16le_16k_mono>` — 인자 1개, 튜닝 플래그 0개, 설정 하드코딩.
- 호출: `sidecar/app/diarization/speakrs_runner.py:49` → `subprocess.run([str(binp), pcm_path], ...)`
- **출력 JSON 계약 (새 래퍼가 반드시 동일 재현):**
  ```json
  {"speakers": ["화자 1", "화자 2", ...],
   "turns": [{"start_ms": <int>, "end_ms": <int>, "speaker": "화자 N"}, ...]}
  ```
  - crate는 **초(f64)** + `SPEAKER_00` 라벨을 줌 → 현 래퍼가 초→ms, raw 라벨→**등장순 1-based `화자 N`** 변환. 새 래퍼도 동일.
  - stderr `[speakrs-cli]` 접두 줄 = 타이밍 로그 (runner가 INFO로 흘림).

### settings.yaml 임계값은 죽은 값
- `clustering_threshold`/`similarity_threshold`/`merge_threshold` 등은 speakrs로 전달 안 됨. 라우터(`stt.py`)는 `diarization_config.get("enable")`만 읽음.

### 과소분할 데이터 — 회의 111 (`backend/storage/development.sqlite3`)
| speaker_label | speaker_name (사용자 rename) | seg | avg s | max s |
|---|---|---|---|---|
| 화자 2 | 이석희 | 330 | 4.17 | 24.0 |
| 화자 1 | **홍춘식, 조덕현** | 272 | 4.95 | 26.0 |
| 화자 3 | 장종익 | 220 | 4.74 | 17.5 |
| 화자 4 | 장한솔 | 139 | 2.93 | 10.3 |

총 961 seg, avg 4.34s, max 26s. `speaker_label`(raw "화자 N") vs `speaker_name`(rename) **별도 컬럼**. "홍춘식, 조덕현"이 한 라벨에 묶인 게 과소분할 증거.

### 문장 섞임 원인 2개
1. **클러스터 과병합** (화자1) → AHC threshold ↓ + CoreMl full 모드로 해결 (Phase 1).
2. `sidecar/app/diarization/overlap.py:20 assign_speaker_summed` — STT 세그먼트 1개를 overlap-sum argmax로 화자 1명에 통째 배정 → 한 세그먼트가 두 화자 걸치면 섞임 (Phase 2 대상).

### Phase 2 관련 (이번엔 조사만)
- `sidecar/app/stt/base.py` `TranscriptSegment` = {text, started_at_ms, ended_at_ms, language, confidence, speaker_label} — **`words` 없음**.
- mlx 어댑터(`mlx_whisper_adapter.py:119`, `mlx_whisper_beam_adapter.py:122`) `word_timestamps=False`.
- **기본 STT 엔진 = `whisper_cpp`** (`factory.py` auto→whisper_cpp), mlx 아님. Apple Silicon서 사용자가 mlx_turbo_beam_8bit로 override 가능.
- vendored `lw_whisper`는 word_timestamps 지원(`transcribe.py:74`, writers가 `segment["words"]` 사용). → Phase 2는 엔진별 경로가 달라 착수 전 추가 조사 필요.

## 임계값 방향 — 소스로 증명 (가장 위험했던 부분)

`src/clustering/ahc.rs`:
- `condensed_euclidean` (L2-normalized embedding 간 euclidean 거리).
- `assign_flat_labels`: `if heights[node] <= threshold { 서브트리 통째 1화자 } else { 쪼갬 }`. `heights = step.dissimilarity` = 병합 거리.

→ **threshold = 거리 컷오프**. 높을수록 병합 허용↑ → 화자 **적음**. **낮을수록 화자 많음** (pyannote/distance 컨벤션, similarity 컨벤션과 반대). 기본 0.6.

외부 실증: pyannote 공식 — under-segmentation 교정 레버 = clustering threshold ↓ (데이터셋별 grid-search, 민감). speakrs가 pyannote community-1 스타일이라 일치.

참고: 거리 0.6 ≈ cos 0.82, 0.4 ≈ cos 0.92(더 엄격→화자 더 쪼갬). 슬라이더 범위 후보 0.3~1.0, 기본 0.6.

## ⚠️ 적대 검토 반영 — 핵심 교정 (2026-06-13)

32-에이전트 적대 검토 결과 3개 설계 결함이 확정됨. 아래 아키텍처는 이를 반영한 **개정판**.

1. **`--mode` 레버는 phantom일 가능성 큼.** `PipelineConfig::for_mode`는 step size를 제어하지 않음(VBx iters만). 정확도의 진짜 레버 = segmentation step(0.96s vs 2.0s)이고 이건 **모델 로드 시 ExecutionMode로 고정**됨(`builder.rs:92` `segmentation_step_seconds(mode)`). `run_with_config`로는 못 바꿈. **+ 실측**: 회의111 세그 경계 66.7%가 1000ms 배수 → 현 바이너리 이미 ~1s step = `CoreMl(full)`. 따라서 mode 전환 이득 ≈ 0. → **`--mode` per-file 플래그 폐기. ExecutionMode는 `CoreMl` 고정.**
2. **AHC threshold가 inert일 수 있음.** 최종 화자수는 AHC가 아니라 VBx 재추정 → `speaker_keep_threshold`(1e-7) 프루닝 → reconstruct 스무딩(ε0.1) **이후**에 확정됨(`post_inference.rs`). threshold↓가 VBx/스무딩에 먹힐 수 있음 → **측정 게이트로 먼저 검증**(아래).
3. **출력 계약 역공학** = 차단 게이트로 승격(아래 golden-diff).

## 선결 측정 게이트 (구현 1번 스텝 — 통과 전 배선 금지)

풀 래퍼/컬럼/UI 빌드 **이전에** 싸게 falsify. 미니 throwaway 바이너리(또는 crate 로컬 수정 + `examples/`):

1. 회의 111 PCM 추출 → AHC threshold **0.3 / 0.4 / 0.5 / 0.6**로 각각 실행.
2. **단계별 화자수 로깅**: AHC 클러스터 수 → post-VBx → post-prune(`speaker_keep_threshold`) → post-reconstruct 최종 수.
3. 판정:
   - threshold↓가 **최종** 화자수를 늘리고 화자1이 2명으로 갈리면 → 레버 살아있음 → 풀 배선 진행.
   - 안 늘면 → VBx/reconstruct가 먹는 것 → 래퍼가 `vbx.max_iters`/`reconstruct_method(Standard)`/`speaker_keep_threshold`도 노출하도록 확장하거나 접근 재설계.
4. 동시 확인: 세그 경계 granularity로 현 바이너리 mode 재확인.

이 게이트가 **mode 스코프(설계 50%)를 통째로 날릴 수 있음** — 그게 목적.

### ✅ 측정 게이트 결과 (2026-06-13, 실행 완료 — PASS)

회의111(4138s) PCM을 `ExecutionMode::CoreMl`(FP32 ~1s step)로 빌드, AHC threshold sweep. throwaway 도구 `/tmp/speakrs-sweep` (cargo 1.94 + `features=["coreml"]` 빌드 성공, 26MB).

| AHC threshold | 최종 화자수 | 세그먼트 |
|---|---|---|
| 0.60 (기본) | 4 | 1923 |
| 0.50 | 4 | 1923 |
| 0.40 | **5** | 1942 |
| 0.30 | 5 | 1943 |
| 0.20 | 8 (과분할) | 2067 |

**판정 PASS:**
1. **threshold 레버 LIVE** — 0.6→0.4서 최종(post VBx+prune+reconstruct) 화자수 4→5. 적대검토 "threshold inert/VBx가 먹음" 가설 **실험 반증**.
2. **목표 ≈ 0.4** — 회의111 실참석자 5명, 기본 0.6=4명(과소분할, 화자1=홍춘식+조덕현 병합)서 0.4=5명. 0.2=8명 과분할.
3. **mode 헛것 확정** — full@0.6 = 4명 = DB 현 바이너리 4라벨 일치 → 현 바이너리 이미 ~full. `--mode` 폐기 정당. **레버 = threshold 단 하나.**
4. **coreml 빌드 검증** — 툴체인/네이티브 deps OK.

→ 풀 배선(B/C/D) 진행 승인. 단, 0.4가 *홍춘식/조덕현* 쌍을 가르는지 최종 확인 = 실제 재전사 후 라벨/청취 검증(구현 후).

## 아키텍처 (Phase 1, 측정 게이트 통과 후)

### A. 새 Rust 래퍼 `sidecar/speakrs-cli/`
- 신규 Cargo 프로젝트. speakrs 0.4.2 의존, `--features coreml` 빌드(macOS). **소스를 git에 커밋**(현 바이너리처럼 orphan 금지).
- 인자:
  - `<pcm>` (positional, 기존 유지)
  - `--ahc-threshold <f32>` (기본 0.4, 게이트 실측 최적 → `PipelineConfig.ahc.threshold`)
  - (측정 게이트가 요구하면) `--vbx-iters` / `--reconstruct std|smoothed` / `--keep-threshold` 추가 노출
- **구성 API**: `OwnedDiarizationPipeline::from_dir(models_dir, ExecutionMode::CoreMl)`로 빌드(step size 0.96s 고정) → `run_with_config(audio, file_id, config)`로 ahc.threshold 주입. ⚠️ `DiarizationPipeline::new(pre-built models)` 예제 패턴은 mode를 못 박으니 사용 금지.
- 출력: **기존 JSON 계약 그대로** (초→ms, raw `SPEAKER_NN`→**등장순(첫 turn 시작시각) 1-based `화자 N`**). stderr 타이밍 로그 유지.
- 모델 경로: `SPEAKRS_MODELS_DIR` 우선, 없으면 기존 바이너리와 동일 해석.
- 빌드 산출물로 `sidecar/bin/speakrs-cli` 교체.

### A2. 출력 골든 차단 게이트 (바이너리 교체 전 필수)
동일 PCM(회의111)을 **기존 바이너리 vs 신규 래퍼** 동일 config로 실행 → 출력 JSON `speakers` 리스트 + `turns`(start_ms/end_ms/speaker 전부) **완전 일치** 검증. 불일치 항목(라벨 정렬 규칙, `merge_gap` 인접 동일화자 병합, overlap 세그 처리)을 관찰로 핀 박고 래퍼에 반영. 통과 전 교체 금지.

### B. Sidecar passthrough — 정확한 threading 지점
- `speakrs_runner.run_speakrs(bytes, ahc_threshold=None)` → 있으면 `--ahc-threshold` 플래그 조립(`subprocess.run` args, 현재 `speakrs_runner.py:49-53`).
- `batch_processor.batch_diarize_speakrs(...)` (현재 `:24-29` 시그니처에 없음) → `ahc_threshold` 파라미터 추가, runner로 전달.
- `routers/stt.py:162-172` → `diar_cfg.get("ahc_threshold")` 추출해 `batch_diarize_speakrs(..., ahc_threshold=...)`로.
- `schemas.py TranscribeFileRequest.diarization_config` → `ahc_threshold: float | None` 허용.

### C. Backend (Rails) — 정확한 배선 지점 (마이그레이션 먼저)
1. **마이그레이션 먼저** (러닝 dev 서버 PendingMigration 500 트랩): `t.float :diarization_threshold, null: true` on meetings. `schema.rb:142-175`에 현재 없음 확인됨.
2. `meetings_controller.rb` update permitted params(`:109-136`)에 `diarization_threshold` 추가 — **빠지면 슬라이더 PATCH가 조용히 드랍됨**. `expected_participants` 패턴 그대로.
3. `file_transcription_job.rb:22` 뒤에 주입: `diarization_config["ahc_threshold"] = meeting.diarization_threshold if meeting.diarization_threshold.present?` (현재 `expected_speakers`만 주입).
4. `app_settings.rb` `DIARIZATION_DEFAULTS`(:8-14) + `diarization_config()`(:24-33)에 `"ahc_threshold" => 0.4` 추가(회의값 없을 때 글로벌 폴백, 게이트 실측 최적값). 현재 5키만 — `ahc_threshold` 없음 확인됨.
5. 죽은 키(`clustering_threshold` 등)와 혼동 주의 — sidecar는 `ahc_threshold`만 읽음.
6. `regenerate_stt`(body 없음)는 그대로 — 저장된 회의값을 job이 픽업.

### D. Frontend — 호스트 명시
- **per-meeting 슬라이더 신규**: 호스트 = `EditMeetingDialog.tsx` (기존 회의 편집 UI). 글로벌 settings `DiarizationPanel`이 아님 — 거긴 토글만 있고 회의별 아님.
- 라벨 "화자 구분 민감도" (낮은 threshold=화자 더 분리를 "민감도 높음"으로 역방향 표시), 범위 0.2~0.8 **0.1 단위 스텝**, 기본 **0.4**(게이트 실측 최적). 참고: 0.2=과분할 절벽, 0.4=5명 고원 중앙.
- state hook + slider → onConfirm에서 `diarization_threshold` 포함 → meeting PATCH API → "STT 재실행"이 사용.
- 기존 글로벌 `DiarizationPanel`/`diarizationOverrides`는 건드리지 않음(회의별이 권위, 글로벌은 폴백 기본값 용도).

## 검증

- 회의 111 재전사(threshold 0.4~0.5, full 모드) → **화자1이 홍춘식/조덕현 2명으로 분리**되는지 + 전체 오분류 감소 + 화자 수가 4→5로 늘어 참석자와 일치하는지.
- 동일 PCM에서 신규 래퍼 vs 기존 바이너리 출력 JSON 스키마 동일성(스파이크 단계).

## 리스크 (적대 검토 반영)

순서: **선결 측정 게이트** → (통과 시) A 빌드 → A2 골든 게이트 → B/C/D 배선.

- **레버 불확실성(최상위)**: mode는 거의 phantom(현 바이너리 이미 full 추정), threshold는 VBx/reconstruct가 먹을 수 있음 → **측정 게이트가 둘 다 판정**. 통과 못 하면 스코프 재설계.
- **빌드 취약성**: Rust 툴체인 + `coreml` feature(objc2 등 네이티브 deps, Xcode 필요). 빌드 요구사항 문서화(`sidecar/speakrs-cli/README`), 가능하면 CI 빌드. 래퍼 소스 git 커밋.
- **모델 경로**: `SPEAKRS_MODELS_DIR` 해석을 기존 바이너리와 정확히 맞춰야(다르면 모델 못 찾음).
- **출력 계약**: A2 골든 게이트가 차단(라벨 정렬/merge_gap/overlap 불일치).
- **플랫폼(비-블로커)**: coreml=mac arm64 전용. 리눅스 서버는 `is_available()` graceful degrade로 diarization 없이 정상(크래시 X). mac-desktop 한정 기능으로 수용. 단 28MB 바이너리 git 교체 시 히스토리 비대 — LFS/아티팩트 검토.

## 범위 밖 / 나중 고려

1. **임베딩 출력 → rename/재클러스터 교정 UI** (제외). `DiarizationResult.embeddings` 있어 가능. "이 둘 같은/다른 사람" 교정.
2. **Phase 2 문장분리** — 엔진(whisper_cpp 기본)별 word_timestamp 경로 조사 → `words` 필드 추가 → overlap.py를 per-word 화자 턴 조회로 세그먼트 분할. 한계: whisper word 시각 ±100~300ms, 진짜 동시발화는 분리 불가.
3. **글로벌 vs 회의별 기본값** — 현재 회의별 컬럼+글로벌 폴백. 매번 조정 싫으면 글로벌 1개로 단순화 여지.
4. **expected_speakers 강제 힌트** — speakrs가 화자수 자동추정. 참석자 수를 힌트로 줄 수 있으면 추가 레버(crate 지원 여부 확인 필요).
5. **실시간(라이브) diarization** — 현재 품질문제로 OFF(`useTranscription.ts`). 이번은 배치만.

## 구현 완료 (2026-06-13, status: done)

브랜치 `feat/diarization-accuracy` 8커밋(a28b098..1955de4, 미푸시). 플랜 `plans/2026-06-13-diarization-accuracy.md`, 결정이력 `2026-06-13-diarization-accuracy-decisions.md`.

- 신규 Rust 래퍼 `sidecar/speakrs-cli/`(CoreMl 고정, `--ahc-threshold`) → `sidecar/bin/speakrs-cli` 교체. 골든게이트 통과(old=4명/1920턴 = new@0.5).
- sidecar passthrough(runner/batch/router) + Rails(컬럼/controller/job/app_settings) + FE 슬라이더(EditMeetingDialog 0.2~0.8 step0.1) + serializer round-trip + 범위검증.
- **통합검증**: `run_speakrs(0.4)` → 5화자, 회의111 961행 overlap 할당 → 5 distinct(과소분할 해소). 테스트 green(sidecar 2/0, rails 3/0·회귀 163/0, FE tsc clean·vitest 8/0).
- **남은 1단계(사용자)**: 라이브 앱서 회의111 민감도 0.4 저장 → STT 재실행 → DB가 화자 1~5 (4→5) 되는지 + 청취 품질 확인.
- 미해결(별도): 슬라이더 전용 단위테스트 없음(소프트갭), 28MB 바이너리 git raw(기존 관례), Phase 2 문장분리.

## 결정된 제약

- speakrs 유지 (pyannote 너무 느림).
- 속도 희생, 정확도 우선 (full 모드).
- 작업은 `feat/diarization-accuracy` 브랜치에서 직접 진행.
