# 온디바이스 STT (sherpa-onnx + Cohere int8) — Android 포팅 & 또박또박 통합 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 날짜: 2026-06-01
- 상태: 플랜 (검토 대기)
- 관련 설계: `docs/superpowers/specs/2026-05-29-ondevice-stt-design.md` (§9 단계 5·6 = 이 플랜), `docs/superpowers/specs/2026-05-28-stt-meeting-language-mode-design.md` (언어 정책 정렬)
- 소스 레포: `/Users/jji/project/ondevice-stt` (실기기 GREEN, P0~P6 완료 — 포팅 원본)

---

**Goal:** 실기기 검증을 마친 `ondevice-stt` 레포의 **sherpa-onnx C-API + Cohere Transcribe 2B int8** 온디바이스 엔진을 **또박또박 프론트(Tauri) Android 타깃에 이식**하고, 전사 백엔드를 **서버(기존 sidecar) / 온디바이스(로컬) 사용자 선택**으로 토글 가능하게 만든다. 로컬 전사 결과는 기존 transcript 파이프라인(`transcriptStore` → BlockNote)에 그대로 흘려 하류 UI를 100% 재사용한다.

**엔진 갱신 노트(중요):** `2026-05-29-ondevice-stt-design.md`는 엔진을 **Qwen3-ASR-0.6B + llama.cpp**로 설계했으나, 실제 빌드·실기기 검증된 `ondevice-stt` 레포는 **sherpa-onnx C-API + Cohere int8 (Route A FFI)**로 갔다. 이 플랜은 그 **실측 채택 엔진**을 기준으로 한다(Qwen/llama.cpp 경로는 폐기). 사용자 명시 요구 = "sherpa-onnx C-API(C++) + Cohere Transcribe 2B int8 ONNX 적용".

**Architecture:**

```
┌─ ddobakddobak/frontend  WebView (React19/TS/Vite) ──────────────────┐
│  마이크/시스템오디오 캡처 (기존 useMicCapture / useAudioRecorder)   │
│         │ PCM Int16 16k (기존 audio-processor.js worklet 재사용)     │
│         ▼                                                            │
│  STT 라우터 ── sttMode ──┬─ 'server' → useTranscription (기존)       │
│                          │     audio_chunk → ActionCable → sidecar   │
│                          └─ 'local'  → useLocalStt (신규)            │
│                                Silero VAD(wasm) → SegmentAccumulator │
│                                → invoke('stt_transcribe',{pcm})      │
│                                → TranscriptFinalData → transcriptStore│
│                                → (영속) POST /meetings/:id/transcripts/bulk
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Tauri command (Android SYNC)
┌──────────────────────────────▼─ Rust (frontend/src-tauri, #[cfg android]) ─┐
│  cohere_ffi::CohereRecognizer  (sherpa-onnx C-API, in-process)              │
│   create(model_dir, language)  · transcribe(pcm)  · Mutex 직렬화            │
│  model_path::ensure_cohere_model  (app_local_data_dir/models/cohere-onnx)   │
│  jniLibs/arm64-v8a: libsherpa-onnx-c-api.so + libonnxruntime.so             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:** Tauri v2.10, Rust(bindgen 0.70, #[cfg(target_os="android")] FFI), sherpa-onnx C-API, Cohere Transcribe 2B int8 ONNX(~2.75GB), React19+TS+Vite, transformers.js(Silero VAD wasm), Zustand, ActionCable, Rails(transcript 영속화).

**범위 노트:**
- 1차 타깃 = **Android**(서버 없이 온디바이스 전사). 데스크톱은 기존 sidecar 경로 유지(온디바이스 데스크톱은 비목표 — 데스크톱은 이미 로컬 sidecar 보유).
- 토글 = **서버 STT ↔ 온디바이스 STT**. "또박또박 로컬모드(데스크톱이 sidecar 직접 구동)"와 **다른 축**임에 주의 — 둘 다 현재는 *서버측* STT다. 이 플랜의 "온디바이스"는 sidecar/백엔드 전사 없이 폰 안에서 추론.
- 비목표(YAGNI): 온디바이스 **화자분리**(pyannote는 서버 전용 — 로컬은 단일 speaker_label), 온디바이스 **다국어 자동감지**(Cohere는 create 시 언어 1개 고정 — 아래 제약), 온디바이스 LLM 요약(서버 유지), iOS.

**선행 사실 (정찰 완료 — 6에이전트 병렬, 2026-06-01):**

소스(`ondevice-stt`) 재사용 자산:
- `src-tauri/src/cohere_ffi.rs` — `CohereRecognizer::create(model_dir)` / `transcribe(pcm)`. Config 계약: `model_type='cohere-transcribe-03-2026'`, `decoding_method='greedy_search'`, `language`(현 `'ko'` 하드코딩 line 79), `use_punct=1/use_itn=1`, `feat sr=16000 dim=80`, `num_threads=4`. **라이브러리가 .so 내 검증문자열로 셋 다 하드검사 — 빠지거나 틀리면 `create()`가 NULL**. accept-once(스트림당 1회), 결과/스트림 매회 해제·recognizer는 Drop만. **Send/Sync assert는 Mutex 직렬화 + 커맨드 SYNC일 때만 건전**(async 래핑 금지).
- `src-tauri/src/text_post.rs` — `cut_eos()` (첫 `<|`서 컷, EOS 누수 방어. 호스트 테스트 포함).
- `src-tauri/src/stt.rs` — Android arm: SYNC `stt_load{model_dir}`/`stt_transcribe{pcm}` + `CohereState(Mutex<Option<..>>)`. `dev_ffi_smoke`(debug-only 20× 루프 게이트).
- `src-tauri/src/model_path.rs` — Android: `app_local_data_dir/models/cohere-onnx` 해석 + `ensure_cohere_model`(스테이징 `/data/local/tmp/cohere-onnx`→앱샌드박스 temp→fsync→rename 복사). `encoder.int8.onnx.data ≥ 2.5GB` 사이즈가드.
- `src-tauri/build.rs:16-82` — `android_sherpa_bindgen()`: 호스트 libclang로 `android-spike/inc/sherpa-onnx/c-api/c-api.h` 파싱 → `OUT_DIR/sherpa_bindings.rs`(allowlist `SherpaOnnx.*`). arch→jniLibs 매핑 + `link-search`/`link-lib`(libsherpa-onnx-c-api, libonnxruntime). **두 .so 모두 DT_SONAME 없음 → 파일명이 load-bearing**.
- JS 파이프라인 `src/stt/`: `useStt.ts`(Silero VAD: 구형 ONNX 입력 `x[1,512],h[2,1,64],c[2,1,64]` — 신형과 다름), `chunker.ts`(SegmentAccumulator), `resample.ts`, `postprocess.ts`(RMS_GATE=0.015), `fixture.ts`. `public/vad-processor.js`(512샘플 worklet). Silero 모델 `public/models/onnx-community/silero-vad/onnx/model.onnx`(629KB).
- 모델 파일 실위치 `ondevice-stt/android-spike/cohere-onnx/`: `encoder.int8.onnx`(2.9MB) + `encoder.int8.onnx.data`(2605MB) + `decoder.int8.onnx`(146MB) + `tokens.txt`(203KB) = **~2.75GB**. (.data는 ORT가 파일명으로 암묵 로드 — 같은 디렉토리 필수, config에 안 넘김.)
- **Cohere 지원 언어(14, .so 검증문자열 실측):** `ar, de, el, en, es, fr, it, ja, ko, nl, pl, pt, vi, zh`.

타깃(`ddobakddobak/frontend`) 현황:
- React19+TS+Vite+Zustand. STT 엔진 선택 UI **이미 존재**: `config.yaml stt_engines` + `SttSettingsPanel` + `getSttSettings()` + `LiveStatusBar`(ENGINE_LABELS_SHORT). → "온디바이스"를 엔진 1종으로 추가하면 UX 자연 정합.
- 서버 STT **이미 존재**: `useTranscription`(`channels/transcription.ts`) → ActionCable `TranscriptionChannel` → `TranscriptionJob` → `SidecarClient#transcribe` → `transcriptStore.finals`(`TranscriptFinalData{id,content,speaker_label,started_at_ms,ended_at_ms,sequence,created_at,audio_source}`) → `useSttBlockInserter` → `TranscriptBlock`. **이 shape가 통합 seam.**
- 캡처: `useMicCapture`(데스크톱, audio-processor.js worklet, PCM Int16 16k, appSettingsStore VAD), `useAudioRecorder`(모바일 10s 청크). `useLiveRecording`가 오케스트레이션.
- 언어 = **사용자별**(`User#language_mode` single/multi + `selected_languages` CSV, `effective_language_config`). 권위 = `meeting.creator`. **회의별 언어 컬럼 없음.** 클라는 mode/languages 전송 안 함(서버 권위).
- ddobak 언어 9개: `ko,en,ja,zh,es,fr,de,th,vi`. **교집합 = th 제외 8개 온디바이스 가능. 태국어(th) = Cohere 미지원 → 서버 전용.**
- Tauri 네이티브: bindgen/sherpa/onnx **없음**. 단 **JNI 선례 있음**(`mdns.rs` multicast-lock, jni=0.21+ndk-context) → FFI 추가 경로 검증됨. Android Gradle 프로젝트 완비(`gen/android/`, `jniLibs/arm64-v8a/`, keystore, minSdk24, **APK 빌드 GREEN** 22.3M). `crate-type=[staticlib,cdylib,rlib]`.
- 모바일은 현재 **서버 전용 STT**(README 109-113, "no local STT runtime on mobile") → 이 플랜이 그 갭을 채움.

**제약 · 트레이드오프 (구현 전 합의 필요):**

| 항목 | 서버 STT | 온디바이스(Cohere int8) |
|---|---|---|
| 화자분리 | pyannote ✓ | ✗ (speaker_label 단일/null) |
| 다국어 자동감지(multi) | ✓ | ✗ (create 시 언어 1개 고정) |
| 태국어(th) | ✓ | ✗ (Cohere 미지원) |
| 언어 전환 | 즉시(서버 설정) | recognizer **재생성 ~12s 콜드로드** |
| 자원 | 서버 RAM | 폰 **모델 2.7GB + RAM**, ~3s/세그먼트 CPU |
| 네트워크 | LAN 서버 필요 | **불필요(오프라인)** ← 핵심 가치 |
| 라이선스 | sidecar 모델별 | **Cohere 매출 임계 라이선스 — 상업 배포 전 확인 필수** |

→ **로컬 모드 정책**: single 모드 + 8개 언어만 온디바이스 허용. multi 모드/태국어/화자분리 필요 회의는 자동으로 서버로 폴백(또는 UI서 로컬 비활성). 언어별 recognizer 캐시는 2.7GB×N이라 금지 → 회의 시작 시 1회 선택·재생성.

---

## Task 0: sherpa 자산 vendoring (header + jniLibs + VAD + fixture)

**목적:** 소스 레포의 네이티브/모델 자산을 또박또박으로 복사. 대용량(.so/.data)은 git 제외.

**Files:**
- Create: `ddobakddobak/frontend/src-tauri/inc/sherpa-onnx/c-api/c-api.h` (헤더)
- Create: `ddobakddobak/frontend/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libsherpa-onnx-c-api.so`, `libonnxruntime.so`
- Create: `ddobakddobak/frontend/public/vad-processor.js`, `ddobakddobak/frontend/public/models/onnx-community/silero-vad/**`
- Create: `ddobakddobak/frontend/src-tauri/fixtures/ko.wav`
- Modify: `ddobakddobak/.gitignore`

- [ ] **Step 1: 헤더 + .so 복사**
```bash
SRC=/Users/jji/project/ondevice-stt
DST=/Users/jji/project/ddobakddobak/frontend/src-tauri
mkdir -p "$DST/inc"
cp -R "$SRC/android-spike/inc/sherpa-onnx" "$DST/inc/sherpa-onnx"
mkdir -p "$DST/gen/android/app/src/main/jniLibs/arm64-v8a"
# 정본 = android-spike/jniLibs/{abi}/ (4 ABI 보유: arm64-v8a, armeabi-v7a, x86, x86_64).
# minSdk24·arm64 타깃이라 arm64-v8a만 복사. 둘 다 DT_SONAME 없음 → 파일명 유지 필수.
cp "$SRC"/android-spike/jniLibs/arm64-v8a/libsherpa-onnx-c-api.so "$DST/gen/android/app/src/main/jniLibs/arm64-v8a/"
cp "$SRC"/android-spike/jniLibs/arm64-v8a/libonnxruntime.so "$DST/gen/android/app/src/main/jniLibs/arm64-v8a/"
```
Expected: 헤더 트리(`inc/sherpa-onnx/c-api/c-api.h` 156KB) + 두 `.so` 존재.

- [ ] **Step 2: VAD worklet + Silero 모델 + fixture 복사**
```bash
SRC=/Users/jji/project/ondevice-stt; DST=/Users/jji/project/ddobakddobak/frontend
cp "$SRC/public/vad-processor.js" "$DST/public/vad-processor.js"
mkdir -p "$DST/public/models/onnx-community/silero-vad"
cp -R "$SRC/public/models/onnx-community/silero-vad/." "$DST/public/models/onnx-community/silero-vad/"
mkdir -p "$DST/src-tauri/fixtures"; cp "$SRC/fixtures/ko.wav" "$DST/src-tauri/fixtures/ko.wav"
```
Expected: `model.onnx`(629KB) + `config.json`(`model_type:custom, sample_rate:16000`) + worklet + ko.wav.

- [ ] **Step 3: .gitignore — 대용량 제외**
`ddobakddobak/.gitignore`에 추가:
```
# 온디바이스 STT 대용량 자산 (배포는 다운로더 — Task 11)
frontend/src-tauri/gen/android/app/src/main/jniLibs/**/*.so
frontend/src-tauri/**/cohere-onnx/
*.onnx.data
```
Expected: `git status`에 .so/.data 미표시. (.so는 빌드 산출/배포 파이프라인서 별도 주입 — Task 12서 결정.)

---

## Task 1: build.rs bindgen + Cargo deps (Android 게이트)

**목적:** Android 빌드 시 sherpa 바인딩 생성 + .so 링크. 데스크톱 빌드는 무영향.

**Files:**
- Modify: `frontend/src-tauri/build.rs`
- Modify: `frontend/src-tauri/Cargo.toml`

- [ ] **Step 1: Cargo.toml — bindgen build-dep + (필요 시) 의존성**
```toml
[build-dependencies]
tauri-build = { version = "2", features = [] }
bindgen = "0.70"   # Android sherpa C-API 바인딩 (호스트 빌드타임)
```
- [ ] **Step 2: build.rs — `android_sherpa_bindgen()` 포팅**
소스 `ondevice-stt/src-tauri/build.rs:16-82`를 이식하되 경로를 또박또박 기준으로:
  - 헤더: `$CARGO_MANIFEST_DIR/inc/sherpa-onnx/c-api/c-api.h`
  - jniLibs: `$CARGO_MANIFEST_DIR/gen/android/app/src/main/jniLibs/{abi}`
  - `CARGO_CFG_TARGET_OS == "android"`일 때만 실행. allowlist `SherpaOnnx.*`. `link-lib=dylib=sherpa-onnx-c-api`, `=onnxruntime`.
  - 기존 build.rs의 macOS Swift rpath 워크어라운드 + `tauri_build::build()`는 보존.
- [ ] **Step 3: 데스크톱 빌드 회귀 확인**
```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run tauri build -- --debug 2>&1 | tail -20
```
Expected: 데스크톱 빌드 영향 없음(android 분기 미실행).

---

## Task 2: cohere_ffi.rs + text_post.rs 포팅 + language 파라미터화

**목적:** in-process recognizer를 또박또박에 이식. **하드코딩 `'ko'` → 파라미터**.

**Files:**
- Create: `frontend/src-tauri/src/cohere_ffi.rs` (Android 게이트)
- Create: `frontend/src-tauri/src/text_post.rs`

- [ ] **Step 1: text_post.rs 그대로 복사** (`cut_eos` + 호스트 테스트).
- [ ] **Step 2: cohere_ffi.rs 복사 + 시그니처 변경**
  - `create(model_dir: &str)` → `create(model_dir: &str, language: &str)`. line 79 `cstr("ko")` → `cstr(language)`.
  - **언어 화이트리스트 검증 추가**(create NULL 방어): `const COHERE_LANGS: &[&str] = &["ar","de","el","en","es","fr","it","ja","ko","nl","pl","pt","vi","zh"];` — 미포함이면 즉시 `Err`.
  - 모듈 doc의 모든 비자명 제약(accept-once, .data 동거, Send/Sync sync-only, model_type/decoding 하드검사) 주석 보존.
- [ ] **Step 3: 호스트 컴파일 + text_post 단위테스트**
```bash
cd /Users/jji/project/ddobakddobak/frontend/src-tauri && cargo test text_post 2>&1 | tail
```
Expected: cut_eos 테스트 통과. (cohere_ffi는 android-only라 호스트선 미컴파일.)

---

## Task 3: STT 커맨드 + 언어전환 recognizer 재생성 + 핸들러 등록

**목적:** `stt_load{model_dir, language}` / `stt_transcribe{pcm}` SYNC 커맨드. 언어 바뀌면 재생성.

**Files:**
- Create: `frontend/src-tauri/src/stt.rs` (Android arm)
- Modify: `frontend/src-tauri/src/lib.rs` (mod 선언 + mobile invoke_handler + manage state)

- [ ] **Step 1: stt.rs — Android arm 포팅 + 재생성 로직**
```rust
// CohereState: recognizer + 현재 로드된 언어
#[cfg(target_os = "android")]
pub struct CohereState(pub Mutex<Option<(String /*lang*/, crate::cohere_ffi::CohereRecognizer)>>);

#[cfg(target_os = "android")]
#[tauri::command]   // SYNC — async 금지(Send/Sync sound 깨짐, stt.rs:83-90 근거)
pub fn stt_load(model_dir: String, language: String, state: State<CohereState>) -> Result<(), String> {
    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    if let Some((lang, _)) = g.as_ref() { if *lang == language { return Ok(()); } } // 멱등
    *g = None; // 언어 변경 → drop 후 재생성 (~12s 콜드로드)
    let rec = crate::cohere_ffi::CohereRecognizer::create(&model_dir, &language)?;
    *g = Some((language, rec));
    Ok(())
}
// stt_transcribe: g.as_ref()의 recognizer로 transcribe.
```
- [ ] **Step 2: lib.rs 등록**
  - `#[cfg(target_os="android")] mod cohere_ffi; mod text_post; mod stt;`
  - mobile 빌더 `.manage(stt::CohereState(Default::default()))`, `invoke_handler`에 `stt::stt_load, stt::stt_transcribe`(+ debug 시 `dev_ffi_smoke`) 추가.
- [ ] **Step 3: Android 컴파일**
```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run tauri android build -- --debug --target aarch64 2>&1 | tail -30
```
Expected: 컴파일 성공, `stt_*` 커맨드 등록.

---

## Task 4: model_path.rs — 해석 + 스테이징 복사

**목적:** 앱 샌드박스 모델 경로 해석 + 첫 실행 복사(다운로더 전까지 adb 스테이징).

**Files:**
- Create: `frontend/src-tauri/src/model_path.rs` (Android)
- Modify: `frontend/src-tauri/src/lib.rs` (`resolve_model_paths` 커맨드 등록)

- [ ] **Step 1: 포팅** — `app_local_data_dir()/models/cohere-onnx` 해석, `paths_in()` 4파일 + `.data ≥ 2.5GB` 가드, `ensure_cohere_model`(스테이징 `/data/local/tmp/cohere-onnx` → temp→fsync→rename). 멱등 fast-path.
- [ ] **Step 2: `resolve_model_paths` 커맨드** — `{dir}` 반환. 프론트가 `stt_load` 전 호출.
- [ ] **Step 3: adb 스테이징 + 검증** (다운로더 전 개발용)
```bash
adb -s R3CR60RAK3R push /Users/jji/project/ondevice-stt/android-spike/cohere-onnx /data/local/tmp/cohere-onnx
```
Expected: 앱 첫 실행서 복사 완료, `.data ≥ 2.5GB` 통과.

---

## Task 5: dev FFI smoke — 온디바이스 sanity 게이트

**목적:** 실기기서 cohere 경로 end-to-end 동작 + RAM 안정 + EOS 누수 확인.

**Files:**
- Modify: `frontend/src-tauri/src/stt.rs` (`dev_ffi_smoke` 포팅, debug-only)

- [ ] **Step 1:** `dev_ffi_smoke` 이식(fixture include_bytes, resolve→create(dir, "ko")→20× transcribe, EOS/빈값 가드, min/max ms 리포트).
- [ ] **Step 2: 에뮬(AVD) + 실기기 검증**
```bash
# 에뮬: ddobak_pixel7_api34 / 실기기: R3CR60RAK3R
# WebView devtools: window.__TAURI__.core.invoke('dev_ffi_smoke')
```
Expected: `OK ... text="안녕하세요..."`, EOS 누수 없음, per_call_ms 폰 ~3s대.

---

## Task 6: JS VAD 파이프라인 자산 + ddobak audio config 정합

**목적:** Silero VAD 청킹을 또박또박에 이식하되, **chunker 파라미터를 또박또박 `appSettingsStore`/`config.yaml audio`와 정합**(소스 상수 하드코딩 대신).

**Files:**
- Create: `frontend/src/stt/chunker.ts`, `resample.ts`, `postprocess.ts`
- Create: `frontend/src/stt/sileroVad.ts` (useStt.ts의 VAD 로딩/프레임 처리 부분만 추출)
- Modify: (정합) `frontend/src/stores/appSettingsStore.ts` 매핑 확인

- [ ] **Step 1:** `chunker.ts`/`resample.ts`/`postprocess.ts` 복사.
- [ ] **Step 2: SegmentAccumulator 파라미터 매핑** — ddobak `config.yaml audio`(sr16000, silence_threshold 0.05, max_chunk_sec 10, min_chunk_sec 2, preroll/overlap 500)를 SegmentAccumulator opts로 변환. **단 Cohere는 8s 상한(maxSegmentS=8 locked)** — `max_chunk_sec`가 8 초과면 8로 클램프(FFI 백스톱과 일치). RMS_GATE는 0.015 유지(무음 환각 차단).
- [ ] **Step 3: Silero 입력 계약** — 번들 ONNX는 구형(`x[1,512],h[2,1,64],c[2,1,64]`, sr 입력 없음, 출력 prob/new_h/new_c). transformers.js `env.allowRemoteModels=false; localModelPath='/models/'` 오프라인 고정. (소스 `useStt.ts:18-20,66-73` 그대로.)
Expected: VAD가 fixture/실마이크서 발화 세그먼트 컷, near-silence 흘림 없음.

---

## Task 7: `useLocalStt` 훅 — transcriptStore에 emit

**목적:** 서버 `useTranscription`의 온디바이스 대응. 동일 캡처 스트림 → VAD/청킹 → invoke → **동일 `TranscriptFinalData` shape**를 `transcriptStore.finals`에 push.

**Files:**
- Create: `frontend/src/hooks/useLocalStt.ts`
- Modify: `frontend/src/stores/transcriptStore.ts` (필요 시 로컬 push 헬퍼)

- [ ] **Step 1: 훅 골격** — `useMicCapture`/`useAudioRecorder`의 `onChunk`(PCM)을 입력으로 받아 Silero VAD + SegmentAccumulator 구동. 세그먼트마다:
```ts
const raw: string = await invoke('stt_transcribe', { pcm: Array.from(seg) });
const content = cutEosLeak(raw);
if (!content) return;
transcriptStore.pushFinal({
  id: localSeq, content,
  speaker_label: null,              // 온디바이스 화자분리 없음
  started_at_ms, ended_at_ms,       // chunker 세그먼트 타임
  sequence: localSeq++, audio_source: 'mic',
  created_at: nowIso,
});
```
- [ ] **Step 2: 생명주기** — 회의 시작 시 `resolve_model_paths` → `stt_load{dir, language}`(언어 = creator effective config, Task 10). VAD state(h/c)는 단일 직렬 drain(동시성 금지 — 소스 주석).
- [ ] **Step 3: 단위/통합** — fixture 경로로 capture→VAD→invoke(mock)→store push 검증. `useSttBlockInserter`가 로컬 final도 BlockNote에 삽입하는지 확인(shape 동일하므로 무수정 기대).
Expected: 로컬 전사 줄이 서버 모드와 시각적 동일하게 렌더.

---

## Task 8: STT 모드 토글 (서버 / 온디바이스)

**목적:** 사용자가 전사 백엔드 택일. 기존 엔진 선택 UI에 통합.

**Files:**
- Modify: `config.yaml` (`stt_engines`에 온디바이스 엔트리)
- Modify: `frontend/src/components/settings/SttSettingsPanel.tsx`
- Modify: `frontend/src/components/meeting/LiveStatusBar.tsx`
- Modify: `frontend/src/hooks/useLiveRecording.ts` (분기)
- Modify: `frontend/src/stores/appSettingsStore.ts` (`sttMode` 상태)

- [ ] **Step 1: config.yaml 엔트리**
```yaml
stt_engines:
  ondevice_cohere:
    label: "온디바이스 (Cohere int8, 오프라인)"
    short: "온디바이스"
```
- [ ] **Step 2: `sttMode` 설정** — `'server' | 'local'`(또는 엔진 선택이 `ondevice_cohere`면 local). `appSettingsStore`에 저장. **가용성 게이트**: local은 (a) 플랫폼이 Android, (b) 모델 present(`resolve_model_paths` 성공), (c) 언어가 Cohere 8개 ∩ ddobak, (d) single 모드 — 아니면 비활성 + 사유 툴팁("태국어/다국어/화자분리는 서버 모드").
- [ ] **Step 3: `useLiveRecording` 분기** — `sttMode==='local'` → `useLocalStt`, else 기존 `useTranscription`. 캡처(useMicCapture/useAudioRecorder)는 공유. `LiveStatusBar`에 활성 엔진 라벨 표시(기존 메커니즘).
Expected: 설정서 "온디바이스" 선택 → 녹음 시 폰 내 전사, 상태바 "온디바이스" 표시. 서버 선택 → 기존 동작 무회귀.

---

## Task 9: 로컬 전사 영속화 (백엔드)

**목적:** 온디바이스 final을 서버 DB에 저장(회의 상세/검색/공유 뷰어 재사용). 오디오 대신 **텍스트** 전송.

**Files:**
- Create/Modify: `backend/app/controllers/api/v1/transcripts_controller.rb` (`bulk_create`)
- Modify: `backend/config/routes.rb`
- Modify: `frontend/src/api/meetings.ts` (또는 transcripts.ts) — `bulkCreateTranscripts`
- Modify: `frontend/src/hooks/useLocalStt.ts` (push 시 서버 전송)

- [ ] **Step 1: 엔드포인트** `POST /api/v1/meetings/:id/transcripts/bulk` — `[{content, speaker_label:null, started_at_ms, ended_at_ms, sequence, audio_source}]` 배치 upsert. **idempotency**: `(meeting_id, sequence)` 유니크로 재시도 중복 방지. 저장 후 `TranscriptionChannel` broadcast(공유 뷰어 동기화 재사용).
- [ ] **Step 2: 프론트 전송** — `useLocalStt`서 final 확정 시 호출(실패 시 로컬 큐 보관·재시도 — 오프라인 대비 최소 버퍼). 회의 종료 시 잔여 flush.
- [ ] **Step 3: 회귀** — 서버 모드 transcript 경로 무영향. 로컬 모드 회의가 상세/검색(FTS)/뷰어에 정상 노출.
Expected: 로컬 전사 회의가 새로고침 후에도 유지, 공유 뷰어가 실시간 수신.

> 비고: v1은 "서버 도달 가능 시 전송". 완전 오프라인 누적·후동기화(SQLite 로컬 캐시)는 후속(설계서 §5 stub 정신과 정합).

---

## Task 10: 언어 매핑 / 정책 (creator 권위 + Cohere 화이트리스트)

**목적:** 로컬 recognizer 언어를 회의 정책에서 결정. 언어모드 설계와 정렬.

**Files:**
- Create: `frontend/src/stt/cohereLang.ts` (ISO→지원 매핑/검증)
- Modify: `frontend/src/hooks/useLocalStt.ts` (언어 결정), `frontend/src/api/...` (creator effective lang 조회)

- [ ] **Step 1: 매핑/정책**
```ts
export const COHERE_LANGS = ['ar','de','el','en','es','fr','it','ja','ko','nl','pl','pt','vi','zh'] as const;
// 회의 언어 = creator effective_language_config (서버 권위, 언어모드 설계).
// single + lang ∈ COHERE_LANGS → 로컬 가능. multi 또는 th → 로컬 불가(서버 폴백).
export function localSttLanguage(cfg: {mode:'single'|'multi'; languages:string[]}): string | null {
  if (cfg.mode !== 'single') return null;
  const l = cfg.languages[0];
  return COHERE_LANGS.includes(l as any) ? l : null;  // th 등 → null
}
```
- [ ] **Step 2: 게이트 연동** — `localSttLanguage()===null`이면 Task 8 가용성 게이트가 로컬 비활성 + 사유 표시. 가능하면 그 ISO를 `stt_load{language}`로.
- [ ] **Step 3: 회의별 언어(선택, 향후)** — 사용자 요구 "회의마다 설정"을 위해 `meetings.language_*` 컬럼 추가는 **언어모드 설계의 "전역→사용자별" 변경과 충돌 검토 후** 별도 결정(이 플랜은 creator 권위 재사용; 회의별 오버라이드는 오픈 질문).
Expected: 한국어 single 회의 → 로컬 "ko". 태국어/multi → 로컬 버튼 비활성 + "서버 모드 필요".

---

## Task 11: 모델 배포 다운로더 (2.7GB, LAN 서버 호스팅)

**목적:** adb 스테이징을 프로덕션 다운로더로 대체. **또박또박 서버가 모델 호스팅 → mDNS/bridge로 LAN 다운로드**(이미 있는 디스커버리 재사용).

**Files:**
- Create: `frontend/src/stt/modelDownloader.ts` + UI 게이트(진행률)
- Create: `backend/...` 모델 정적 서빙 라우트(또는 기존 서버 정적 호스팅)
- Modify: `frontend/src/hooks/useLocalStt.ts` (다운로드 선행)

- [ ] **Step 1:** 첫 로컬 사용 시 4파일 다운로드 → `app_local_data_dir/models/cohere-onnx`. **resumable + `.data ≥ 2.5GB` 가드 + 체크섬**. 부분 파일은 stub로 남지 않게(temp→rename).
- [ ] **Step 2:** 소스로 LAN 서버(mDNS로 발견된 base) 우선, 폴백 CDN. (서버가 `cohere-onnx/`를 정적 제공.)
- [ ] **Step 3:** 진행률 UI + 실패/오프라인 안내·재시도(설계서 §6/§7).
Expected: 폰서 첫 로컬 모드 진입 → 다운로드(LAN) → 이후 캐시 재사용.

> 리스크: 2.7GB 다운로드/저장. 저사양·저장공간 기기 사전 체크 + 안내.

---

## Task 12: Android 패키징 / 서명 / APK 검증

**목적:** .so + 모델 경로 포함 APK 빌드·실기기 설치 검증. (모델은 APK 밖 — 다운로더.)

**Files:**
- Modify: `frontend/src-tauri/gen/android/app/build.gradle.kts` (jniLibs keepDebugSymbols 등 필요 시)
- (서명) `gen/android/keystore.properties` 정책

- [ ] **Step 1: 빌드**
```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run tauri android build -- --target aarch64 2>&1 | tail -30
```
- [ ] **Step 2: 실기기 설치 + E2E**
```bash
adb -s R3CR60RAK3R install -r <apk>
# 회의 시작 → 온디바이스 모드 → 실시간 전사 → 종료 → 영속 확인
```
- [ ] **Step 3:** APK에 두 `.so`(arm64-v8a) 포함 확인(`unzip -l`). 서명 정책 결정(현재 release unsigned). CI는 Android 미포함 — 수동 빌드 명시.
Expected: 실기기서 서버 없이 온디바이스 연속 전사 GREEN.

---

## 검증 전략

- **단위:** `text_post`(Rust), `cohereLang`/chunker/resample/postprocess(TS), `localSttLanguage` 정책.
- **통합:** `dev_ffi_smoke`(Task 5, 20× RAM/EOS), `useLocalStt` fixture 경로(capture→VAD→invoke mock→store).
- **수동(실기기 R3CR60RAK3R / AVD ddobak_pixel7_api34):** 서버↔온디바이스 토글, 한국어 single 연속 회의(RTF/RAM/발열), 언어전환 재생성, 태국어/multi 게이트 비활성, 공유 뷰어 동기화.
- **회귀:** 서버 STT 경로·데스크톱 sidecar·기존 transcript UI 무영향.

## 리스크

- **Send/Sync sound = SYNC 커맨드 전제.** `stt_transcribe`에 async 래핑 절대 금지(메모리 안전 위반).
- **모델 2.7GB**: 다운로드/저장/RAM. 저사양 기기 폴백 미정.
- **.so DT_SONAME 없음** → 파일명 load-bearing. jniLibs 이름 변경 금지.
- **.data 동거 암묵 로드**: 누락 시 무에러 segfault. 사이즈가드로만 방어.
- **라이선스(Cohere 매출 임계)**: 상업 배포 전 법무 확인 — `license-before-benchmark` 메모.
- **언어전환 ~12s 콜드로드**: 회의 중 전환 UX 비용. 시작 시 1회 선택 권장.

## 오픈 질문 (검토 시 결정 요망)

1. **회의별 언어 vs 사용자별(creator) 권위** — 사용자 요구 "회의마다 설정"이 언어모드 설계의 "사용자별 권위"와 충돌. 회의별 `language` 컬럼 추가할지? (Task 10 Step3)
2. **로컬 화자분리 부재** 수용 가능? (speaker_label null) 또는 로컬도 단순 화자 추정 필요?
3. **오프라인 누적·후동기화** v1 포함? (Task 9는 "서버 도달 시 전송"만)
4. **모델 호스팅** — 또박또박 서버 LAN 서빙 vs 외부 CDN? (Task 11)
5. **데스크톱 온디바이스** 필요? (현재 비목표 — 데스크톱은 sidecar)
6. **APK 서명/배포** 정책(현재 unsigned, CI Android 미포함).
