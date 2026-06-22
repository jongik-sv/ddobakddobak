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
| 백그라운드 녹음 UX | **숨긴 채 녹음 + OS 알림** | auto 모드 무확인 의도 유지, 사용자 방해 최소 |
| 트리거 소유권 | **Rust로 이전** | 숨긴 창의 JS `setInterval`은 App Nap이 스로틀 → 60s GRACE 미스 위험. Rust 타이머는 정시 발화 |
| 닫기 동작 | 빨간 X = 다이얼로그, **cmd+Q = 진짜 종료** | 맥 관습 |
| dock 아이콘 | **유지(Regular)** | 발견성. 트레이 + dock 둘 다 복원 경로 |

## 4. 아키텍처 — 컴포넌트 5개

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
3. Rust tokio 타이머가 트리거 시각 도달 시 webview로
   `emit('scheduled-meeting-trigger', { meetingId, mode })`.
4. 프론트가 이벤트 수신 → **기존 auto 분기 로직 재사용**:
   - 창 숨김 유지(보이면 그대로) + `/meetings/{id}/live` autoStart.
   - OS 알림 "녹음 중: <회의명>" (4.5). 트레이 툴팁/배지로 "녹음 중" 표시.
   - 알림/트레이 클릭 → 창 복원.
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

## 5. 데이터 흐름 요약

```
데스크톱(local):
[Rust 폴 루프] ─reqwest GET 127.0.0.1:13323/api/v1/meetings/scheduled (loopback admin)
   │ (60s)
   ▼
[Rust 스케줄러] 다음 트리거 계산
   │  lead 2분 전 ─► caffeinate 보유(4.4)
   │  트리거 ─────► emit('scheduled-meeting-trigger')
   ▼
[프론트] (리스너) 창 숨김 유지 + /live autoStart + OS 알림 "녹음 중" + 트레이 배지

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

- **Rust 이벤트 발화했는데 webview가 숨김 상태로 navigation 실패**: 프론트가 `/live` 이동 후 autoStart. 숨김 창도 React 라우팅 동작(웹뷰 살아있음). 실패 시 알림에 "복원해서 확인" 안내.
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
- **프론트**: `onCloseRequested` 모달 분기(hide/quit/기억), `scheduled-meeting-trigger` 수신→navigation, 웹 모드 현행 발화 회귀(vitest).
- **수동 E2E(기기)**:
  1. 창 닫기 → 모달 → 백그라운드 → 트레이 클릭 복원.
  2. 창 숨긴 채 예약 시각 도달 → 자동 녹음 시작 + 알림.
  3. 화면 끈 상태(디스플레이 슬립) 예약 → 실행.
  4. 유휴 방치(시스템 슬립 임박) + 예약 임박 → assertion으로 안 잠들고 실행.
  5. cmd+Q → Rails/sidecar 정리 확인.
- **회귀**: 기존 vitest 풀 그린 유지(웹 예약 경로 불변).

## 9. 구현 단위 (writing-plans에서 상세화)

1. 트레이 아이콘 + show/hide 토글 (Rust).
2. `quit_app` 커맨드 + `Destroyed` 정리 경로 정리.
3. 닫기 모달 + onCloseRequested + localStorage pref (프론트).
4. Rust 폴 루프(reqwest, loopback 무토큰) + serde 구조체 + 부팅 재시도 가드 + 트리거 계산 단위테스트 + `scheduled-meeting-trigger` emit.
5. 프론트 `useScheduledMeetings` 분기: desktop=JS 폴 제거하고 이벤트 리스너만, web=현행 타이머 유지.
6. power assertion(caffeinate) + 녹음 상태 통지.
7. notification 플러그인 + "녹음 중" 알림.
8. (옵션) autostart 플러그인 + 설정 토글.
9. 수동 E2E 체크리스트 실행.
