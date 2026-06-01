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

## 갭 보강 결정 — 실기기 스크린샷 후속 (A21+)

실기기 스크린샷으로 발견한 갭 2개(① 오프라인 경로에 모델 다운로드 UI 없음, ② 로그인 화면 탈출구).

| # | 결정 | 근거 |
|---|---|---|
| A21 | 갭1 스코프 = **B(실제 동작)** — 오프라인 경로 다운로드 UI + **T11 서버 정적 라우트까지 구현** | 검증 결과: `cohere-onnx/` 서버 라우트가 Caddyfile/routes.rb/public 어디에도 없음 → 다운로드는 서버가 **떠 있어도 404**(A19가 미룬 인프라 미구현). "버튼 위치"가 아니라 "동작 여부"가 진짜 갭. 사용자 선택=B. 완전 오프라인(서버 0)은 물리적으로 2.7GB 생성 불가 → "최초 1회 연결 필요, 이후 영구 오프라인"으로 정직하게 재정의 |
| A22 | T11 서버 호스팅 = **Caddy `file_server`**(Rails 아님), 경로 `/api/v1/cohere-onnx/*` | 모바일 base=`getApiBaseUrl()`=`…/api/v1`, 루프백 브릿지가 path 보존 전달(bridge.rs `format!("{}{}",target,path_and_query)`) → 서버는 `/api/v1/cohere-onnx/<file>` 수신. `@backend path /api/*`가 가로채기 전에 `handle_path`를 **먼저** 배치(adapt로 순서 확인). 2.6GB 정적 blob은 file_server가 적합(Puma 워커 점유·X-Sendfile 미설정 회피, range 지원). root=adb 스테이징과 동일 소스 `…/ondevice-stt/android-spike/cohere-onnx`. ⚠ prod Caddy도 동일 블록+모델 배치 필요(배포가이드) |
| A23 | 모델 UI = 공유 컴포넌트 `ModelManager`(상태·용량·다운로드%·삭제) — SttSettingsPanel/LocalMeetingsHome/LocalMeetingLivePage 게이트 3곳 재사용 | SttSettingsPanel 인라인 게이트를 추출해 DRY. 사용자 요구: 진행률 % + 모델 관리(미사용 시 삭제). 삭제는 native confirm 대신 인라인 확인 상태(Tauri 모달 dialog 차단 회피) |
| A24 | 다운로드 획득 순서 = **adb 스테이징(ensure_cohere_model) 우선 → 실패 시 네트워크(download_cohere_model)** | 스테이징은 네트워크 불필요(개발/사전적재 기기 즉시). base 빈 문자열(서버 미연결)이면 네트워크 시도 전에 "서버 연결 필요" 정직 안내. delete는 샌드박스만 지우고 스테이징은 보존(재설치 소스) |
| A25 | 갭2 = LoginPage에도 오프라인 탈출구(`<a href=/local-meetings>`, IS_TAURI&&IS_MOBILE) | SetupGate(f88d950)와 동일 패턴(BrowserRouter+Tauri index.html fallback로 hard nav 착지 검증됨). 로그인·서버설정 양쪽에 탈출구 노출 결정 |

### A21+ 검증(이번 작업)
- Rust: `cargo test model_path` 호스트 **7 passed**(+installed_bytes). android `cargo check --target aarch64-linux-android` GREEN(delete_cohere_model/bytes 컴파일).
- Caddy: `caddy validate` Valid + `caddy adapt`로 cohere-onnx file_server가 api/* reverse_proxy보다 **앞** 확인.
- 프론트: ModelManager vitest **7/7**, 관련 타깃 **103/103**, `vite build` GREEN.
- ⚠ 미증명(실기기 수동): 실제 기기서 서버 1회 연결→다운로드% 진척→오프라인 전사, 삭제 후 재다운로드.

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
- **실제 on-device 실행**: 엔진(T5 Cohere FFI), Silero in WebView, 콜드 오프라인 도달성(클린 빌드
  + 실제 escape-hatch 클릭→reload→/local-meetings 착지).
- **A20 더블-VAD 버그 수정**: 초기 useLocalStt는 audio-processor가 이미 VAD로 자른 청크를 Silero+
  SegmentAccumulator로 재분할 → pre-cut 청크엔 trailing silence 없어 다음 청크/flush까지 emit 지연·병합
  버그(advisor 지적). **수정**: 로컬 모드 청크는 이미 전사 가능 세그먼트이므로 재-VAD 제거,
  stt_transcribe에 직접 전달. **실제 useLocalStt.sendChunk 구동 통합테스트로 검증**(단일 청크가
  두 번째 청크 없이 즉시 final emit). useLocalStt는 더 이상 Silero/SegmentAccumulator 미사용.
- **파이프라인 E2E(이전)**: 재구성 루프(훅 아님)로 fixture 구동했던 것 — 모듈은 증명하나 production
  훅 조립은 아니었음. A20 통합테스트가 그 갭을 메움.
- **마이크→전사 라이브 leg**: 에뮬 마이크 없음 → 실기기 수동 검증 권장(코드경로는 통합테스트로 증명,
  마이크 입력만 다름).
- **단위/컴파일**: vitest 172(+useLocalStt 4), RSpec 12, tsc 신규파일 0에러, vite build, android
  cross-compile, APK .so 3종.

## 미결(후속)
- **실기기 마이크 라이브 검증**: 실기기(R3CR60RAK3R)서 실제 발화→연속 전사 RTF/RAM/발열(플랜 수동검증).
- **T11 서버측 정적 호스팅**: dev/LAN Caddyfile은 구현됨(A22, `handle_path /api/v1/cohere-onnx/*` file_server). ⚠ **prod Caddy는 동일 블록 + 서버 호스트에 모델 4파일 배치 필요**(배포가이드). 모델 소스는 현재 `…/ondevice-stt/android-spike/cohere-onnx` 절대경로 — 배포 시 서버 로컬 경로로 교체.
- A13: Workflow 리뷰 에이전트 read-only화(localStore 삭제 사고 방지).
- Cohere 상업 라이선스 — 배포 전 법무 확인.
- 빌드 경고: App 청크 500KB 초과(코드분할 권장, 비기능).

## G1 — 오프라인 라이브 UI 패리티

- **A26** 오프라인 전사 본문의 인라인 편집은 **비활성**. `LiveRecord`에 `editable?: boolean`(기본 true) 추가, 오프라인은 `editable={false}`. 사유: 서버 없는 오프라인에서 `updateTranscript` POST는 실패→롤백되어 편집이 사라짐. 거짓 affordance 제거. 오프라인 편집 영속은 비목표(YAGNI). 서버 경로는 기본 true라 무영향.
- **A27** 종료(stop) 후 **재개 허용**. `MobileRecordControls` 기본 동작(비녹음=「회의 시작」) 그대로 사용, 별도 「완료」 분기 없음. 이탈은 뒤로가기.
- **A28** 상태/에러는 **단일 `LiveStatusBar.statusMessage` surface**. 우선순위 `resolveErr > rec.error > (resolving?'준비 중...':null)`. 제거한 커스텀 배너/평문 에러 영역의 대체. 서버 셸과 동일 패턴.
- **A29**(부수) 모바일 폴리시: `.bn-editor` 좌우 패딩 모바일(lg 미만) 54px→16px(index.css), AppLayout 모바일 헤더 `min-h-12→min-h-10`·버튼 `p-2.5→p-2`. G1과 별개 시각 정리.
