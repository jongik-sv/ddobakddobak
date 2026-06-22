# Tauri 백그라운드 실행 · 트레이/메뉴바 · 예약 회의 백그라운드 자동시작 — 설계

- 날짜: 2026-06-22
- 브랜치: `feat/tauri-background-tray`
- 범위: **Phase 1 (root 권한 없음)**, macOS 먼저
- 대상 앱: `frontend/src-tauri` (Tauri v2.10, 단일 창)

## 1. 목적

데스크톱 앱(Tauri)을 **백그라운드에서 계속 실행**시키고, 메뉴바(macOS)/시스템 트레이(Windows)
아이콘으로 창을 띄우고 숨긴다. 창을 닫아도 프로세스는 살아 있어 **예약 회의가
백그라운드에서 자동 실행**된다. 닫을 때 "백그라운드 유지 / 완전 종료"를 묻는다.

## 2. 현재 상태 (조사 결과)

- Tauri v2.10, 단일 창(`tauri.conf.json`). 트레이/메뉴 설정 **없음**.
- `src-tauri/src/lib.rs`: 등록 플러그인 = deep-link, shell, fs, dialog, log.
  - 윈도우 이벤트 핸들러는 **`Destroyed`만** 처리 → Rails(13323)·Python sidecar kill.
  - `CloseRequested` 가로채기 **없음** → 닫으면 OS 기본 동작으로 프로세스 종료.
- 예약 회의 자동시작: **클라이언트 측 React 타이머**.
  - `frontend/src/hooks/useScheduledMeetings.ts` — 30s `setInterval` 폴.
  - `frontend/src/lib/computeScheduleActions.ts` — auto/manual 윈도우 계산(GRACE 60s, manual lead 60s).
  - `<ScheduledMeetingWatcher/>` (App.tsx)에 마운트. **창이 닫히면 폴 중단 → 예약 미실행.**
  - auto 모드(desktop): 무확인으로 `/meetings/{id}/live` + `autoStart` 네비게이션.
- 플랫폼 구분: `frontend/src/config.ts` — `IS_TAURI`, `getMode()` (local/server).

## 3. 핵심 설계 결정 (확정)

| 항목 | 결정 | 이유 |
|------|------|------|
| 슬립 처리 | **Phase 1 무-root 유지방식** | 책상 위 열린 맥(화면만 꺼짐/유휴슬립)이 90% 케이스. root wake는 Phase 2 |
| OS 범위 | **macOS 먼저** | 트레이/숨김/닫기다이얼로그는 크로스플랫폼 동작, 슬립차단(assertion)만 mac. Windows wake는 후속 |
| 백그라운드 녹음 UX | **트리거 시 창 표시 후 녹음 + OS 알림** | 시작 시 `window.show()`(네이티브, 웹뷰 suspend 무관)가 이벤트 수신·마이크 AudioContext를 한 번에 보장. 숨긴 채는 조용히 실패 가능 |
| 트리거 소유권 | **Rust로 이전** | 숨긴 창의 JS `setInterval`은 App Nap이 스로틀 → 60s GRACE 미스 위험. Rust 타이머는 정시 발화 |
| 닫기 동작 | 빨간 X = 다이얼로그, **cmd+Q = 진짜 종료** | 맥 관습 |
| dock 아이콘 | **유지(Regular)** | 발견성. 트레이 + dock 둘 다 복원 경로 |
| 숨김 녹음 마이크 | **시작 시 창 표시로 해소** | 마이크=JS 캡처(`feed_recorder_mic`). show-at-trigger가 suspend 자체를 제거 → PCM 감시·폴백 불필요. "숨긴 채 녹음"은 스파이크로 입증 후의 **향후 최적화**(범위 밖) |
| 빈 회의 정리 | **무음 5분+ → 자동 완료** | 예약 시작했으나 아무도 없으면 빈 녹음 무한 방지. show-at-trigger로 suspend 버그가 없어 *진짜 빈 회의*에만 동작 |
| 모델 프리로드 | **예약 1분 전 STT 모델 워밍업** | sidecar STT lazy 로드 콜드스타트 제거 → 시작 즉시 전사 |

## 4. 아키텍처 — 컴포넌트 7개

### 4.1 트레이 아이콘 (Rust)

- `lib.rs` `setup()`에서 `TrayIconBuilder`로 메뉴바/트레이 아이콘 생성.
- 툴팁 "또박또박", 앱 아이콘 재사용.
- **좌클릭**: 메인 창 `is_visible()` 토글 — 숨김이면 `show()`+`set_focus()`, 보이면 `hide()`.
- **메뉴 항목**: `열기`, (옵션)`새 회의`, 구분선, `완전 종료`.
  - `열기` → show+focus. `완전 종료` → `quit_app` 경로(아래 4.2).
- 인터페이스: Rust 전용. JS에서 직접 호출 없음.
- 의존성: tauri v2 core의 `tray-icon` feature (별도 크레이트 불필요). `Cargo.toml`/`tauri.conf.json`에서 활성화.

### 4.2 닫기 가로채기 (프론트 주도 + Rust 종료 커맨드)

- 프론트(데스크톱 한정): `getCurrentWindow().onCloseRequested(async (e) => { e.preventDefault(); ... })`.
- 모달 표시: **`[백그라운드 유지]` `[완전 종료]`** + `다음부터 묻지 않기` 체크박스.
  - 선택 기억 → `localStorage` 키(`closeAction` = `hide` | `quit`). 기억돼 있으면 모달 생략, 저장된 동작 즉시 수행.
- `백그라운드 유지` → `getCurrentWindow().hide()`. **프로세스·Rails·sidecar 유지** (Destroyed 미발화 → 기존 kill 로직 안 탐).
- `완전 종료` → 신규 Rust 커맨드 `quit_app()` 호출 → `app.exit(0)` → `Destroyed` → 기존 정리(Rails/sidecar kill).
- **cmd+Q**: 가로채지 않음 → 정상 종료(= `quit_app` 동등 정리). 맥 표준.
- 트레이 `완전 종료` 메뉴도 `quit_app` 경유.
- 인터페이스:
  - JS→Rust: `invoke('quit_app')`.
  - 모달은 기존 모달 패턴(React) 재사용.

### 4.3 백그라운드 스케줄러 (Rust 소유 — 핵심, **티어 C: Rust 직접 폴**)

데이터 출처도 발화 주체도 Rust. 숨김 중 웹뷰를 깨우지 않아 유휴 배터리 ≈0.

데스크톱(`IS_TAURI && local`) 경로:
1. Rust tokio 폴 루프가 **직접** `GET http://127.0.0.1:13323/api/v1/meetings/scheduled`
   를 `reqwest`로 호출(이미 의존성 있음).
   - **인증=loopback 로컬 admin, 무토큰.** `default_user_lookup.rb:12-16` — loopback 요청은
     SERVER_MODE 여부와 무관하게 맥 본체 데스크톱 앱을 로컬 admin으로 취급.
   - 폴 간격: 기본 60s(유휴 시 더 길게 가능). 부팅 직후 백엔드 미준비 시 재시도 가드.
2. Rust가 응답(serde 역직렬화: `id, scheduled_start_time, auto_start_mode`)에서
   다음 auto/manual 트리거 시각 계산(JS `computeScheduleActions`와 동일 규칙: GRACE 60s, manual lead 60s).
3. Rust tokio 타이머가 트리거 시각 도달 시 **메인 창을 먼저 표시**(`window.show()`+`set_focus()` —
   네이티브 호출이라 웹뷰 suspend와 무관, 콘텐츠 프로세스·AudioContext 동시 복원)한 뒤 webview로
   `emit('scheduled-meeting-trigger', { meetingId, mode })`.
4. 프론트가 이벤트 수신 → **기존 auto 분기 로직 재사용**:
   - 창이 이미 표시된 상태(3에서 show) + `/meetings/{id}/live` autoStart.
   - OS 알림 "녹음 중: <회의명>" (4.5). 트레이 툴팁/배지로 "녹음 중" 표시.
5. 이중 발화 방지: 기존 triggered-set(이미 트리거된 회의) 가드 유지. Rust도 발화한 meetingId 기록.

웹/서버 모드: **현행 JS 타이머 폴+발화 그대로**(변경 0). Rust 폴 경로는 데스크톱 로컬에서만.
프론트의 desktop JS 폴은 **제거**(Rust가 폴 소유) — `useScheduledMeetings`는 desktop에서
`scheduled-meeting-trigger` 리스너만, web에서 현행 타이머만.

- 인터페이스:
  - Rust→Rails: `reqwest GET /api/v1/meetings/scheduled` (loopback, 무토큰).
  - Rust→JS: `emit('scheduled-meeting-trigger', { meetingId, mode })`.
- 의존성: 이 컴포넌트가 4.4(assertion)를 트리거 전후로 호출.

### 4.4 Power assertion — 유휴슬립 차단 (Rust, macOS)

- 다음 구간에 시스템 유휴슬립 차단:
  - (a) 예약 트리거 **2분 전(lead)** ~ 회의 종료(또는 assertion 최대 보유 상한, 아래 누수 가드).
  - (b) **녹음 활성 중**(수동 녹음 포함).
- 구현: `caffeinate -is` 자식 프로세스를 보유하다가 구간 종료 시 kill. (IOKit FFI 불필요, `-i` 유휴 차단 `-s` 시스템 슬립 차단)
- **디스플레이 슬립은 차단하지 않음** — 화면 꺼져도 시스템 깨어있으면 녹음 정상.
- 인터페이스: Rust 내부. 스케줄러(4.3)·녹음 상태에서 `assertion_acquire()/assertion_release()` 호출.
- 녹음 상태를 Rust가 알아야 함: 프론트가 녹음 시작/종료 시 `invoke('set_recording', { active })` 통지(또는 기존 녹음 상태 신호 재사용).

### 4.5 알림 + (옵션) 자동시작

- `tauri-plugin-notification` 추가 → 백그라운드 녹음 시작 시 "녹음 중: <회의명>" OS 알림.
- (옵션) `로그인 시 자동 시작` 설정: `tauri-plugin-autostart`, **기본 OFF**.
  - 켜면 재부팅 후에도 앱이 떠서 예약 생존. 설정 UI 토글 1개.
- 의존성: notification 필수, autostart 옵션.

### 4.6 무음 자동완료 (빈 회의 정리 — 단독 기능)

> 마이크 보장은 4.3의 **show-at-trigger로 이미 해소**. 마이크 PCM은 JS 캡처(`useMicCapture` →
> `feed_recorder_mic(pcm_base64)`)라 웹뷰가 살아야 흐르는데, 트리거 시 `window.show()`가
> 콘텐츠 프로세스·AudioContext를 살리므로 suspend 무음이 발생하지 않는다. 따라서 PCM 감시·show 폴백은
> **Phase 1에서 불필요(삭제)**. ("숨긴 채 녹음"은 향후 최적화 — §7 범위 밖.)

무음 자동완료는 그와 **독립된** 빈 회의 정리용:

- 녹음 중 **연속 무음(RMS≈0)이 5분 이상**이면 회의를 자동 `handleStop()`(완료).
- 예약 자동시작했으나 참석자가 없으면 빈 녹음이 무한정 이어지는 것을 막는다.
  show-at-trigger로 suspend 가짜무음이 없으므로, 5분 무음은 *진짜 빈 회의*만을 의미 → 진짜 회의 오종료 위험 없음.
- RMS는 이미 STT 게이트(`RMS_GATE`)에서 계산 — 같은 신호 재사용. 5분 카운터는 무음 연속,
  유음 1회로 리셋(순수 함수로 분리해 단위테스트).
- 인터페이스: 프론트 내부(녹음 PCM 콜백에서 무음 카운터 누적) → 임계 도달 시 기존 `handleStop()` 재사용.

### 4.7 모델 프리로드 (예약 1분 전 STT 워밍업)

정정된 사실: sidecar(FastAPI, 127.0.0.1:13324)는 모델을 **eager 로드**(시작 시 `lifespan`에서
`load_model()` 블로킹). 우리 설계상 sidecar는 숨김 중에도 살아있어 보통 모델은 이미 로드됨.
콜드스타트의 실질 원인 2개: (1) 첫 추론 커널 컴파일(MLX/CUDA lazy eval — 첫 `generate()` 느림),
(2) sidecar 재시작 직후 미로드(드묾).

- sidecar 신규 **`POST /warmup`**: 실시간 어댑터(`app.state.stt_adapter`)로 **2초 무음 1회 추론**
  실행 → 커널 컴파일 완료 + 모델 로드 보장. 200 반환(이미 warm이면 빠르게).
  - 기존 `/transcribe`는 <2s 청크를 스킵(`MIN_CHUNK_BYTES`)해 워밍업 불가 → 전용 엔드포인트 필요.
- Rust 스케줄러: 각 auto/manual 예약 **T-60s**에 `reqwest POST http://127.0.0.1:13324/warmup`.
  - 실패(sidecar 미응답)는 로그만, 트리거는 그대로 진행(녹음 시작 시 자연 로드).
- 리드 타임 정리: **T-120s** assertion 획득(4.4) · **T-60s** 모델 워밍업(4.7) · **T-0** 트리거 발화(4.3).
- 인터페이스: Rust→sidecar `POST /warmup` (loopback, 무인증 — sidecar는 localhost 전용).

## 5. 데이터 흐름 요약

```
데스크톱(local):
[Rust 폴 루프] ─reqwest GET 127.0.0.1:13323/api/v1/meetings/scheduled (loopback admin)
   │ (60s)
   ▼
[Rust 스케줄러] 다음 트리거 계산
   │  T-120s ─► caffeinate 보유(4.4, 유휴슬립 차단)
   │  T-60s  ─► POST sidecar /warmup (4.7, 모델 커널 워밍업)
   │  T-0    ─► window.show()+focus(웹뷰·AudioContext 복원) → emit('scheduled-meeting-trigger')
   ▼
[프론트] (리스너) /live autoStart + OS 알림 "녹음 중" + 트레이 배지
   │  녹음 중 무음 5분+ → handleStop() 자동완료(4.6, 빈 회의 정리)

웹/서버:
[Rails] GET /meetings/scheduled ◄─ [JS 30s 타이머 폴+직접 발화] (현행 유지, 변경 0)
```

닫기 흐름:
```
빨간 X ─► onCloseRequested preventDefault ─► 모달
   ├─ 백그라운드 ─► window.hide() (프로세스 유지)
   └─ 완전 종료 ─► invoke('quit_app') ─► app.exit ─► Destroyed ─► Rails/sidecar kill
cmd+Q ─► (가로채지 않음) 정상 종료
```

## 6. 에러 처리 / 엣지 케이스

- **이벤트 미수신·마이크 무음(웹뷰 suspend)**: Rust가 트리거 시 `window.show()`+focus를 **먼저** 호출 → 콘텐츠 프로세스·AudioContext 복원 후 emit. 이벤트 수신과 마이크 PCM이 함께 보장됨(같은 원인, 한 번에 해결).
- **이중 발화(Rust + 잔존 JS)**: triggered-set 공유 가드. 데스크톱에선 JS 직접 발화 비활성.
- **assertion 누수**: 회의 종료/녹음 종료/앱 종료 시 caffeinate 자식 반드시 kill(`Destroyed`에서도 정리).
- **sync 호출 빈도**: 폴 30s마다 갱신. Rust는 최신 목록으로 타이머 재설정(idempotent).
- **시계 변경/표류**: Rust 타이머는 절대시각 기준 재계산. 폴마다 재동기화로 보정.
- **앱 미실행 상태의 예약**: 실행 안 됨. 자동시작 ON 또는 Phase 2 필요. 문서화.
- **놓친 예약의 상태(딥슬립·앱종료·재부팅으로 미실행)**: **기존 백엔드 모델 그대로 — 변경 없음.**
  - 예약 회의는 `Meeting(scheduled_start_time 有, status: pending)`. 트리거 유예
    (`SCHEDULE_TRIGGER_GRACE`≈60s) 경과 후 미시작이면 `Meeting.missed_scheduled` 스코프
    (`meeting.rb:166`)에 잡혀 **"놓친 예약" 목록에 계속 pending으로 노출**. 삭제 안 됨.
  - 사용자가 나중에 **수동 시작**(pending이라 가능) 또는 **dismiss**(`schedule_dismissed_at`)할 때까지 유지.
  - **반복 회의**: `ScheduleRolloverJob`(1분 cron)이 다음 occurrence 자동 예약, 놓친 원본은 pending 유지.
  - **깨어난 뒤 유예 경과 시 자동 재시작 안 함**: 늦은 빈 녹음 방지. 놓친 목록에서 수동 시작이 올바른 동작.
  - → 딥슬립 미실행 = 현재 "앱 닫혀서 놓친 회의"와 동일 경로. Phase 1 기능이 바꾸지 않음.

## 7. 범위 밖 (명시)

- 뚜껑 닫힌 딥슬립 중 자동녹음 = **Phase 2**(SMAppService root 헬퍼 + `pmset schedule wake` + 공증).
- Windows의 슬립-웨이크 예약(Task Scheduler wake timer) = 후속.
- 디스플레이 슬립 차단(화면 강제 ON) = 불필요(범위 밖).
- **"숨긴 채 녹음"(트리거 시 창 안 띄움)** = 향후 최적화. 선행 스파이크 필요: 숨긴 WKWebView가
  이벤트 루프 + 마이크 AudioContext를 유지하는가? 입증되면 show-at-trigger를 숨김 유지로 교체.
  미입증 상태로는 조용한 미스(이벤트 미수신/무음) 위험이라 Phase 1에서 제외.

## 7.5 배터리 영향

- **유휴 백그라운드(예약 임박 아님)**: App Nap 미해제 → 숨긴 웹뷰 nap, **Rust 폴이 웹뷰를 안 깨움
  (티어 C)** → CPU≈0. 비용=Rails+sidecar 상주 RAM(수백 MB, idle CPU≈0, sidecar torch lazy).
  유휴 드레인 ≈0에 수렴.
- **예약 2분 전~회의 중**: assertion이 그 구간에만 유휴슬립 차단(상시 아님). 이때는 어차피
  녹음(마이크+STT+요약)이 드레인 주범 — assertion 추가분은 2분 lead + 복귀 갭 정도.
- **자동시작 ON**: 로그인부터 유휴 비용이 종일. 기본 OFF.
- 버린 "항상 깨어있기" 대안 대비 우수 — 평소 잠들게 두고 예약 근처에서만 깨움.

## 8. 테스트 전략

- **순수 로직**: 다음 트리거 시각 계산(Rust)을 JS `computeScheduleActions`와 동일 규칙으로 단위테스트(고정 입력→예상 트리거).
- **무음 자동완료 로직**: 무음 연속 카운터(5분 임계, 유음 리셋)를 순수 함수로 분리해 단위테스트.
- **sidecar `/warmup`**: pytest로 2초 무음 입력 → 200 + 어댑터 추론 1회 호출 검증(어댑터 목).
- **프론트**: `onCloseRequested` 모달 분기(hide/quit/기억), `scheduled-meeting-trigger` 수신→navigation, 웹 모드 현행 발화 회귀(vitest).
- **수동 E2E(기기)**:
  1. 창 닫기 → 모달 → 백그라운드 → 트레이 클릭 복원.
  2. 백그라운드(숨김) 앱 + 예약 시각 도달 → 창 자동 표시 + 녹음 시작 + 알림. 첫 전사 즉시(워밍업).
  2b. 예약 자동시작 후 참석자 없음 → 무음 5분 후 자동 완료.
  3. 화면 끈 상태(디스플레이 슬립) 예약 → 실행.
  4. 유휴 방치(시스템 슬립 임박) + 예약 임박 → assertion으로 안 잠들고 실행.
  5. cmd+Q → Rails/sidecar 정리 확인.
- **회귀**: 기존 vitest 풀 그린 유지(웹 예약 경로 불변).

## 9. 구현 단위 (writing-plans에서 상세화)

1. 트레이 아이콘 + show/hide 토글 (Rust).
2. `quit_app` 커맨드 + `CloseRequested`→hide / `Destroyed` 정리 경로 정리.
3. 닫기 모달 + onCloseRequested + localStorage pref (프론트).
4. Rust 트리거 계산(chrono, 순수) 단위테스트.
5. Rust 폴 루프(reqwest, loopback 무토큰) + serde 구조체 + 부팅 재시도 가드 + 트리거 시 `window.show()`+focus + `scheduled-meeting-trigger` emit.
6. 프론트 `useScheduledMeetings` 분기: desktop=JS 폴 제거하고 이벤트 리스너만, web=현행 타이머 유지.
7. power assertion(caffeinate) + 녹음 상태 통지(T-120s lead + 녹음 중).
8. sidecar `POST /warmup` 엔드포인트(2초 무음 추론) + Rust T-60s 호출.
9. notification 플러그인 + "녹음 중" 알림.
10. (옵션) autostart 플러그인 + 설정 토글.
11. 무음 5분 자동완료(RMS 연속 무음 카운터 → handleStop, 빈 회의 정리).
12. 수동 E2E 체크리스트 실행.
