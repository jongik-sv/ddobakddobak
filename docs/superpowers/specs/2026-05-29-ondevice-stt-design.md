# 온디바이스 STT 앱 설계

- 날짜: 2026-05-29
- 상태: 설계 (검토 대기)
- 관련 메모: `reference_moonshine_transformersjs` (실측 근거)

## 1. 목표

또박또박과 **별개인 독립 신규 Tauri 앱**. 100% **온디바이스(오프라인)** 한국어 **회의록 연속 전사**. 서버 STT 불필요.

- **1차**: Android 우선 독립 프로토타입.
- **2차(잘 되면)**: STT 엔진을 **이식 가능한 모듈**로 분리해 또박또박 본 앱에 통합.
- 통합 시 **서버 STT(기존 sidecar) + 로컬 STT(온디바이스) 둘 다 선택 가능** — 택일 아님.

비목표(YAGNI): 화자 분리, 데스크톱 전용 최적화, 다국어 UI, 실시간 서버 공유(별도 기능).

## 2. 모델 선택 근거 (실측)

PC(Mac) 실측으로 후보 전수 비교. 상세는 `reference_moonshine_transformersjs` 메모.

| 모델 | 런타임 | 크기 | 속도 | 한국어 품질 | 판정 |
|---|---|---|---|---|---|
| moonshine-tiny-ko | 브라우저 wasm | 작음 | RTF 0.2 | 낮음+반복 | ✗ 품질 |
| whisper-small fp32 | 브라우저 **WebGPU** | — | RTF 0.15 | 좋음 | 데스크톱용 |
| whisper-small fp32 | 브라우저 wasm | — | RTF 1.2 | 좋음 | ✗ 밀림 |
| whisper-base q8 | 브라우저 wasm | — | RTF 0.13 | 환각 | ✗ 품질 |
| SenseVoice int8 | sherpa-onnx | 237MB | RTF 0.02 | 단어 누락 | 폴백 후보 |
| Qwen3-ASR-0.6B int8 | sherpa-onnx | 937MB | RTF 0.25 | 거의 완벽 | 후보 |
| **Qwen3-ASR-0.6B Q4_K_M** | **llama.cpp** | **666MB** | **RTF 0.27** | **거의 완벽** | **채택** |

**핵심 발견:**
- 브라우저 wasm은 **실시간 vs 품질 택1** (Whisper 고정 30초 윈도우 비용 때문). 동시 달성은 가속 필요.
- WebGPU는 데스크톱만 — **Android 시스템 WebView는 WebGPU 거의 미지원** → 모바일은 wasm뿐 → 브라우저 경로로 모바일 고품질 불가.
- 결론: **모바일 고품질 = 네이티브 추론 필수.**
- Qwen3-ASR-0.6B: 또박또박 sidecar가 쓰는 1.7B와 같은 모델군, 0.6B로도 거의 완벽. GGUF Q4_K_M이 sherpa int8보다 작고(666 vs 937MB) 품질 동급+.
- llama.cpp = Android 네이티브 최강 지원(NEON, Vulkan/OpenCL/NPU 오프로드) + 양자화 유연.

**미검증 리스크:** 실제 폰 ARM RTF(맥 CPU RTF 0.27 → 폰은 2~4배 느릴 수 있음, 회의록 지연 허용으로 가용 추정), 폰 RAM(666MB 모델+런타임), Qwen 짧은 단클립 동작, Tauri Android에서 llama.cpp 빌드 통합.

## 3. 아키텍처 (Tauri v2)

```
┌─ WebView (React/TS) ─────────────────────────┐
│  • UI: 녹음 토글 / 실시간 트랜스크립트 / 회의목록 / 내보내기 │
│  • 마이크 캡처: getUserMedia 16kHz mono PCM (안드 검증됨)   │
│  • VAD: Silero(wasm) — 침묵서 발화 세그먼트 경계 컷         │
│  • Transcriber 인터페이스 호출                              │
└───────────────┬───────────────────────────────┘
                │ 세그먼트 PCM (Tauri command / IPC)
┌───────────────▼─── Rust 코어 ──────────────────┐
│  • stt-core: Transcriber 트레이트                          │
│    - LocalTranscriber: llama.cpp(Qwen3-ASR-0.6B Q4_K_M)   │
│    - ServerTranscriber: 기존 sidecar/ActionCable (통합 시) │
│  • 모델 로더 / 첫 실행 다운로드 / 캐시                      │
└────────────────────────────────────────────────┘
```

### STT 백엔드 추상화 (통합 대비 핵심)

공통 인터페이스 — 독립앱은 `local`만, 또박또박 통합 시 둘 다 선택:

```
trait Transcriber {
    fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> Result<Segment>;
}
// Segment { text, start_ms, end_ms }
```

- `LocalTranscriber`: llama.cpp 임베드. `llama-cpp-2` crate 바인딩 또는 `llama-mtmd` sidecar 바이너리 번들. 모델 = GGUF Q4_K_M(462MB) + mmproj Q8(204MB).
- `ServerTranscriber`: 기존 또박또박 경로(WS→sidecar). 통합 단계에서 추가.
- 선택: 설정/회의별 `stt_backend: local | server`.

## 4. 데이터 흐름 (연속 전사)

1. 사용자 "회의 시작" → 마이크 스트림 시작.
2. AudioWorklet → 512샘플 프레임 → Silero VAD(wasm).
3. VAD가 발화 시작 감지 → 버퍼 누적. **침묵(~400ms) 또는 최대 세그먼트 길이 도달** 시 세그먼트 확정.
   - Qwen은 가변길이라 whisper식 고정비용 없음 → 침묵 정렬 컷이 적합(경계 단어 안 깨짐).
   - 최대 세그먼트 캡(예: 15~20s)으로 장황한 무중단 발화도 강제 분할.
4. 세그먼트 PCM → Rust `Transcriber.transcribe()` → 텍스트.
5. 트랜스크립트 줄 추가(렌더), 로컬 저장.
6. "회의 종료" → 잔여 버퍼 flush(마지막 발화 유실 방지).

## 5. 저장 (로컬 전용)

- 회의: `{id, title, created_at, segments[], audio_path?}`. SQLite(tauri-plugin-sql) 또는 파일.
- 세그먼트: `{text, start_ms, end_ms}`.
- 오디오 원본 저장은 선택(재생/재처리용).
- **서버 전송 = 인터페이스 stub만**(메서드 시그니처·UI 진입점 자리만, 구현은 후속). 나중 또박또박 동기화 대비 시드.

## 6. 모델 배포

- 666MB → **첫 실행 다운로드**(APK 작게 유지, 캐시 후 재사용). 번들은 APK 비대.
- 다운로드 실패/오프라인 첫 실행 처리 필요(안내 + 재시도).
- 저장 위치: 앱 데이터 디렉토리.

## 7. 에러 처리 / 폴백

- 모델 로드 실패 → 명확한 에러 + 재다운로드 옵션.
- 마이크 권한 거부 → 안내.
- 폰 RAM 부족/OOM → 더 작은 양자화(IQ3_M ~617MB) 또는 SenseVoice(237MB) 폴백 경로 고려.
- 전사 호출 실패 → 해당 세그먼트 스킵 + 로그(연속성 유지, 체인 오염 금지 — POC서 겪은 버그).

## 8. 테스트 전략

- 단위: VAD 세그먼트 경계 로직, 청킹/flush, 체인 오염 회귀.
- 통합: Rust `LocalTranscriber`가 고정 한국어 fixture wav 전사(품질·비크래시).
- 수동(실기기): 실제 폰서 연속 회의 녹음 → 실시간 유지·품질·RAM·발열 확인. **RTF 실측이 최대 미검증 항목.**

## 9. 단계 (제안)

1. **독립 Tauri 앱 골격** + WebView UI(녹음/트랜스크립트/목록).
2. **Rust LocalTranscriber** (llama.cpp + Qwen Q4 GGUF) + Tauri command.
3. **VAD 연속 청킹**(WebView Silero) → 세그먼트 → 전사 → 렌더.
4. **로컬 저장** + 내보내기.
5. **실기기 검증**(RTF/RAM) + 필요 시 양자화/폴백 조정.
6. (잘 되면) **엔진 모듈화 → 또박또박 통합** + 서버/로컬 백엔드 선택.

## 10. 검증된 자산 (POC)

- 브라우저 POC: `/Users/jji/project/moonshine-poc/` (moonshine 수동조합, whisper 윈도우, WebGPU — 실측 근거).
- 네이티브 POC: `/Users/jji/project/qwen-native-poc/` (sherpa-onnx + llama.cpp mtmd, Qwen3-ASR-0.6B 한국어 전사 검증).
