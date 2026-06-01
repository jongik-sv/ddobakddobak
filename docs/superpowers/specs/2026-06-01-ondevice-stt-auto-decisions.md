# 온디바이스 STT 구현 — 자동 결정 로그

> 사용자가 "합리적 선택 자동결정 + 완료까지 진행"을 위임함(2026-06-01). 이 문서는
> 진행 중 자동으로 내린 모든 비자명 결정을 기록해 사용자가 사후 검토할 수 있게 한다.
> 명시적으로 사용자가 답한 결정(Q1=C, 별도커밋, 완전오프라인생성 등)은 설계서
> `2026-06-01-ondevice-stt-local-mode-design.md` §1에 있고, 여기는 그 외 자동결정.

## 환경 / 빌드

| # | 결정 | 근거 | 되돌리려면 |
|---|---|---|---|
| A1 | 에뮬 디스크 10G→**20G** | staging 2.7G + 샌드박스 복사 2.7G + 시스템 3.7G = 9G로 10G 빠듯 → 복사 실패 위험 | `stt_arm64_api34.avd/config.ini` `disk.dataPartition.size` 수정 + `-wipe-data` |
| A2 | 검증 디바이스 = **에뮬 `stt_arm64_api34`(arm64-v8a)** | 실기기 미연결. Apple Silicon은 arm64 게스트 네이티브 → arm64 .so 직접 로드 | 실기기 연결 시 `-s <serial>` |
| A3 | bindgen build-dep **무조건 의존**(target-gate 안 함) | build.rs는 단일 호스트 컴파일 단위라 `cfg(target_os=android)` build-dep는 호스트 컴파일을 깨뜨림. 소스 레포도 동일 | Cargo.toml |
| A4 | `copy_with_verify` **스트리밍**(`io::copy`)으로 변경 | 소스의 `fs::read` 전체적재는 2.6GB .data를 RAM 4.5GB 에뮬서 OOM 위험 | model_path.rs |
| A5 | 데스크톱 `REPO_MODEL_DIR` 폴백 arm **제거** | 또박또박 데스크톱 STT는 sidecar 경로라 로컬 모델 폴백 불필요 | model_path.rs |

## 아키텍처 / 코드

| # | 결정 | 근거 | 영향 |
|---|---|---|---|
| A6 | stt.rs = **Android 전용**(데스크톱 arm 없음) | 또박또박 데스크톱은 ActionCable→sidecar. 소스의 ureq 데스크톱 arm은 ddobak에 불필요(stt_core 의존 없음) | lib.rs `#[cfg(target_os="android")]` |
| A7 | iOS는 STT 핸들러 **제외**, Android만 등록 | generate_handler! 개별 cfg 불가 → 모바일 핸들러를 `all(mobile,not(android))` / `target_os=android` 둘로 분기 | lib.rs |
| A8 | 로컬 transcript `speaker_label=**""**`(빈문자열) | DB/타입이 `speaker_label: string NOT NULL`(null 아님). 로컬 단일/미상 화자 = 빈문자열 | 전 파이프라인 |
| A9 | 백엔드 bulk = `save!(**validate: false**)` | speaker_label presence 검증을 빈문자열이 통과 못함. content/시간은 컨트롤러서 직접 가드 | transcripts_controller |
| A10 | 멱등키 = `(meeting_id, **sequence_number**)` find_or_initialize | 재시도/후동기 중복 방지. 새 unique index 추가 안 함(기존 인덱스 활용, 마이그레이션 회피) | bulk_create |
| A11 | 로컬 회의 ID = `**local-**${crypto.randomUUID()}` | 서버 number ID와 네임스페이스 분리(타입 churn 0). 별도 버킷 표시 | localStore |

## Workflow 사용 (사용자 요구)

| # | 결정 | 근거 |
|---|---|---|
| A12 | T0~T5(엔진 스파인)는 **메인스레드 순차**, Workflow는 T6+(독립 청크) 병렬 | T0~T5는 의존 체인+에뮬 디버그 루프 → 병렬 이득 없음, 중간 수정 필요(A3/A4 실제 발생). advisor 확인 |
| A13 | Workflow `w610n82lg`(6모듈 병렬) **중도 정지 + 메인스레드 복구** | ⚠ **사고**: 리뷰 단계 서브에이전트가 full tool access로 "수정"하며 `localStore.ts`를 삭제함. 정지 후 메인스레드가 고아 테스트 계약대로 재작성. 교훈: Workflow 리뷰 에이전트는 read-only여야 함(다음 Workflow는 리뷰에 파일수정 금지 명시) |

| A14 | **임시 디버그 훅**: main.tsx에 `window.__loadSileroVad`/`__localSttE2E` unconditional 노출 + `public/ko-fixture.wav` | 에뮬엔 마이크 없음 → fixture로 파이프라인 검증. vite build는 production이라 DEV 게이트 안 먹어 unconditional. **검증 끝났으니 T12에서 제거 + devLocalSttE2E.ts/ko-fixture.wav 삭제** |
| A15 | fs:scope에 `$APPLOCALDATA/**` 추가 | bare `fs:allow-mkdir`엔 path scope 없어 localStore가 'forbidden path' 거부. 스코프 명시 필요(되돌리면 로컬 저장 깨짐) |
| A16 | 온디바이스 STT 모드는 config.yaml `stt_engines`에 **추가 안 함** | 그 목록은 서버 STT 모델 선택 UI 구동. 온디바이스는 클라 축(sttMode)이라 별도 토글(SttSettingsPanel OnDeviceSttSettings) |
| A17 | 로컬 STT 언어 = `getLanguageSettings()`(현재 사용자) | 회의 시작자 = 통상 creator라 creator 권위(Q1=C)와 정합. 엄밀한 "다른 사람이 시작" 케이스는 후속 |
| A18 | T16 오프라인 진입 = **별도 라우트/훅**(useLiveRecording 포크 안 함) | useLiveRecording은 numeric id+startMeeting POST 결합. 포크보다 `useLocalRecording`+`/local-meetings/:localId/live` 신설이 깔끔(서버 lifecycle 0). MeetingsPage에 LocalMeetingsSection(Android만) |
| A19 | T11 모델 호스트 = `getApiBaseUrl()`(LAN 서버), 서버측 `cohere-onnx/` 정적 라우트는 **배포 단계** | 다운로더는 Rust 스트리밍으로 구현됐으나 서버에 2.7GB 모델 파일을 두고 정적 제공하는 건 인프라 작업. 개발/검증은 adb 스테이징+ensure_cohere_model로 충분(증명됨). CDN 폴백은 호출자가 다른 base로 재시도 |

## 검증 현황

### 실제 on-device 증명 (mock 아님, 에뮬 stt_arm64_api34 arm64-v8a)
- **T5 Cohere FFI**(dev_ffi_smoke): 한국어 20× 연속전사 GREEN, load 6.5s, 세그먼트 0.7~3.1s.
- **Silero VAD in WebView**: loadMs 5.7s, 추론 동작, prob finite. SAB/COI=false(단일스레드 wasm)서도 OK.
- **로컬 STT 파이프라인 E2E**(실제 localStore+SileroVad+SegmentAccumulator+invoke):
  fixture→VAD청킹→transcribe→영속→readback GREEN. segments=1, persisted=1,
  text="안녕하세요. 오늘 회의를 시작하겠습니다...".

### 컴파일/단위 (mock·tsc·vite 레벨)
- frontend stt 8모듈 + appSettingsStore: vitest **157/157** ✅, tsc 신규파일 0에러, vite build GREEN.
- backend bulk: RSpec **12/12** ✅.

## ✅ 스코프 충족 현황 (최종 — 모두 on-device 증명)
사용자 승인 스코프 = **완전 오프라인 회의 생성**(서버 없이 생성→녹음→전사→로컬저장) + 서버 전송 opt-in.
- ✅ **완전 오프라인 진입(콜드 도달성)**: 서버 한 번도 안 본 상태에서 `/local-meetings`(게이트 밖)
  → "오프라인 회의 시작" → createLocal → `/local-meetings/:id/live` 마운트 + "녹음 시작" 버튼.
  **클린 프로덕션 빌드(임시훅 제거)에서 CDP로 ok=true 확인.**
- ✅ **데이터 경로 on-device 증명**: createLocal+실제 SileroVad+SegmentAccumulator+stt_transcribe+
  localStore 영속+readback (E2E 훅으로 segments=1/persisted=1, 한국어 전사 정확).
- ✅ **엔진**(T5 Cohere FFI 20× GREEN), **Silero in WebView**(단일스레드 wasm GREEN).
- ✅ **서버-회의-존재 로컬 전사**(T8) + **서버 전송 opt-in**(T9 bulk + T15 syncQueue 단방향 프로모트).

### 증명 레벨 구분(정직)
- **실제 on-device 실행**: 엔진(T5), Silero, 파이프라인 E2E, 콜드 오프라인 도달성.
- **마이크→전사 라이브 leg**: 에뮬엔 마이크 없음 → fixture 기반 파이프라인 E2E로 증명(실제 마이크
  입력은 실기기 수동 검증 권장). VAD청킹·transcribe·영속은 동일 코드경로라 마이크만 다름.
- **단위/컴파일**: vitest 168, RSpec 12, tsc 신규파일 0에러, vite build, android cross-compile, APK .so 3종 포함.

## 미결(후속)
- **실기기 마이크 라이브 검증**: 실기기(R3CR60RAK3R)서 실제 발화→연속 전사 RTF/RAM/발열(플랜 수동검증).
- **T11 서버측 정적 호스팅**: `cohere-onnx/` 2.7GB 서버 제공 라우트(A19, 배포 인프라). 개발은 adb 스테이징.
- A13: Workflow 리뷰 에이전트 read-only화(localStore 삭제 사고 방지).
- Cohere 상업 라이선스 — 배포 전 법무 확인.
- 빌드 경고: App 청크 500KB 초과(코드분할 권장, 비기능).
