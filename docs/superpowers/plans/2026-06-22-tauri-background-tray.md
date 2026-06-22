# Tauri 백그라운드 실행 · 트레이/메뉴바 · 예약 백그라운드 자동시작 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 Tauri 앱이 창을 닫아도 백그라운드(트레이/메뉴바)로 계속 살아, 예약 회의가 시각에 맞춰 자동 시작(시작 시 창 표시)되고, 유휴슬립을 막고, 모델을 미리 워밍업한다.

**Architecture:** 닫기는 창을 파괴하지 않고 숨긴다(Rails/sidecar 유지). Rust가 예약 스케줄을 소유(127.0.0.1:13323 직접 폴 → 트리거 시각 계산 → 메인 창 `show()` 후 `scheduled-meeting-trigger` emit). 프론트는 그 이벤트를 받아 기존 `/live` autoStart 경로로 녹음을 시작한다. 슬립 차단은 `caffeinate -is` 자식 프로세스, 모델 워밍업은 sidecar 신규 `POST /warmup`.

**Tech Stack:** Tauri v2.10 (Rust, `app_lib` lib crate), React + TypeScript (vitest), FastAPI sidecar (Python, pytest), Rails API (참조만). chrono(신규 Rust dep), reqwest(기존), tokio(기존), tauri-plugin-notification·tauri-plugin-autostart(신규).

## Global Constraints

이 섹션의 값은 모든 태스크에 암묵적으로 포함된다. 정확히 지킬 것.

- **Spec**: `docs/superpowers/specs/2026-06-22-tauri-background-tray-design.md` (Phase 1, macOS 먼저).
- **Tauri** `2.10`, `Cargo.toml`의 `tauri = { version = "2.10", features = [] }` → 트레이 위해 `features = ["tray-icon"]` 추가 필요.
- **lib crate name** = `app_lib`; 데스크톱 엔트리 `main.rs` → `app_lib::run()`; `run()`은 `src/lib.rs:54-189`.
- **window label** = `"main"` (tauri.conf.json windows 배열에 label 없음 → 기본 "main"; capabilities/default.json `windows: ["main"]`와 일치).
- **capability 파일**: `frontend/src-tauri/capabilities/default.json` 단 하나. 새 permission은 여기에 추가.
- **local API base** = `http://127.0.0.1:13323/api/v1`. **loopback = 로컬 admin, 무토큰** (`backend/app/controllers/concerns/default_user_lookup.rb:12-16` — SERVER_MODE 무관, 맥 본체 loopback은 로컬 admin).
- **sidecar** = `http://127.0.0.1:13324` (config.yaml; `SIDECAR_PORT` 기본 13324). localhost 전용, 무인증.
- **`scheduled_start_time` 포맷** = ISO8601 UTC ms 문자열 `"2026-06-22T14:30:00.000Z"` (NOT epoch). Rust는 `chrono::DateTime::parse_from_rfc3339`로 파싱. JS는 `Date.parse`.
- **시간창 상수**: GRACE = **60s**, MANUAL_LEAD = **60s**. 백엔드 `Meeting::SCHEDULE_TRIGGER_GRACE = 60.seconds`(`meeting.rb:30`)와 **반드시 동일**. auto 창 `[scheduled, scheduled+60s)`, manual 창 `[scheduled-60s, scheduled+60s)`, **상한 배타**. `missed` 플래그는 무시(strict-past라 정각 직후 true).
- **behavior-change for web/server mode = ZERO.** 데스크톱(`IS_TAURI && getMode()==='local'`) 경로만 바뀐다. 웹/모바일/원격서버의 기존 JS 타이머 폴+발화는 글자 그대로 보존.
- **Tauri-only npm 플러그인**은 테스트에서 vite alias stub 필요 (`frontend/vite.config.ts:15-18`가 plugin-deep-link에 대해 하는 패턴) 또는 `vi.mock`.
- **Tauri invoke 관용구** = `IS_TAURI` 가드 + 동적 `import('@tauri-apps/api/core').then(({invoke})=>invoke('cmd')).catch(()=>{})` (`useLiveRecording.ts:350` 선례). `listen`은 `'@tauri-apps/api/event'`.
- **confirmDialog**: `frontend/src/lib/confirmDialog.ts` 헬퍼만 사용. raw `window.confirm` 금지(WKWebView non-blocking 버그).
- **Power assertion** = `caffeinate -is` 자식 프로세스(macOS). IOKit FFI 금지.
- **frequent commits**: 각 태스크 끝 1 커밋. 커밋 메시지 한글 OK.
- **회귀**: 변경 후 `cd frontend && npm test`(vitest run) 그린, `cd frontend/src-tauri && cargo build` 통과.

---

### Task 1: 트레이 아이콘 + 창 show/hide 토글 (Rust)

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml:25` (tauri features)
- Create: `frontend/src-tauri/src/tray.rs`
- Modify: `frontend/src-tauri/src/lib.rs:42` (mod 선언), `:155-186` (setup에서 tray 생성)

**Interfaces:**
- Produces: `tray::create_tray(app: &tauri::AppHandle) -> tauri::Result<()>` — 트레이 아이콘 생성·이벤트 배선. setup()에서 desktop일 때 호출.
- Produces(헬퍼): `tray::toggle_main_window(app: &tauri::AppHandle)` — "main" 창 visible 토글.

- [ ] **Step 1: Cargo에 tray-icon feature 추가**

`frontend/src-tauri/Cargo.toml`의 tauri 라인을 수정:
```toml
tauri = { version = "2.10", features = ["tray-icon"] }
```

- [ ] **Step 2: tray 모듈 작성**

`frontend/src-tauri/src/tray.rs` 생성:
```rust
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// "main" 창을 보이기/숨기기 토글. 숨김이면 show+focus, 보이면 hide.
pub fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

/// 메뉴바/시스템 트레이 아이콘 생성. 좌클릭=창 토글, 메뉴=열기/완전 종료.
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItemBuilder::with_id("open", "열기").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "완전 종료").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .separator()
        .item(&quit_item)
        .build()?;

    TrayIconBuilder::with_id("ddobak-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("또박또박")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
```

- [ ] **Step 3: lib.rs에서 모듈 선언 + setup 호출**

`frontend/src-tauri/src/lib.rs` 상단 모듈 선언부(다른 `mod` 옆, 예: line 42 근처)에 추가:
```rust
#[cfg(desktop)]
mod tray;
```
그리고 `setup(|app| { ... })` 안, 기존 desktop mDNS 블록(lib.rs:165-173) 바로 다음에 추가:
```rust
            #[cfg(desktop)]
            {
                if let Err(e) = tray::create_tray(app.handle()) {
                    log::warn!("트레이 생성 실패: {e}");
                }
            }
```

- [ ] **Step 4: 빌드 검증**

Run: `cd frontend/src-tauri && cargo build`
Expected: 컴파일 성공(경고만 허용). 트레이 코드 타입 에러 0.

- [ ] **Step 5: 수동 스모크(개발 실행)**

Run: `cd frontend && npm run tauri dev` (또는 프로젝트 dev 스크립트)
Expected: 메뉴바에 또박또박 아이콘. 좌클릭 시 창 숨김↔표시 토글. 트레이 메뉴 "열기"=창 표시, "완전 종료"=앱 종료.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/tray.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(tray): 메뉴바 트레이 아이콘 + 창 show/hide 토글"
```

---

### Task 2: `quit_app` 커맨드 + `CloseRequested`→hide 재배선 (Rust)

현재 `on_window_event`(lib.rs:106-112)는 `Destroyed`만 처리해 backend·sidecar를 kill한다. 닫기(빨간 X)는 창을 파괴하지 말고 숨겨야 한다. 진짜 종료는 `quit_app`/cmd+Q → `app.exit(0)` → `Destroyed` → 기존 정리.

**Files:**
- Create: `frontend/src-tauri/src/window_cmd.rs`
- Modify: `frontend/src-tauri/src/lib.rs:85-105` (generate_handler! 등록), `:106-112` (on_window_event)

**Interfaces:**
- Consumes: `kill_child`, `AppState` (lib.rs 기존).
- Produces: `#[tauri::command] window_cmd::quit_app(app: AppHandle)` — `app.exit(0)`.
- Produces: `#[tauri::command] window_cmd::show_main_window(app: AppHandle)` — "main" 창 show+focus (Task 5/9에서 재사용).

- [ ] **Step 1: window_cmd 모듈 작성**

`frontend/src-tauri/src/window_cmd.rs` 생성:
```rust
use tauri::{AppHandle, Manager};

/// 프론트/트레이의 "완전 종료" 경로. app.exit(0) → WindowEvent::Destroyed → 기존 정리(kill_child).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// "main" 창을 표시+포커스. 예약 트리거(Task 5)·알림 클릭(Task 9)에서 재사용.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
```

- [ ] **Step 2: lib.rs 모듈 선언 + 커맨드 등록**

`lib.rs` 모듈 선언부에 추가:
```rust
#[cfg(desktop)]
mod window_cmd;
```
desktop `generate_handler!` 리스트(lib.rs:85-105)의 끝(`audio::read_recording,` 다음)에 추가:
```rust
                  window_cmd::quit_app,
                  window_cmd::show_main_window,
```

- [ ] **Step 3: on_window_event에 CloseRequested→hide 추가**

`lib.rs:106-112`을 아래로 교체:
```rust
              .on_window_event(|window, event| match event {
                  // 닫기(빨간 X): 파괴하지 않고 숨긴다 — 프론트가 먼저 preventDefault 후
                  // 백그라운드/완전종료를 결정(Task 3). 여기서는 안전망으로 hide.
                  tauri::WindowEvent::CloseRequested { api, .. } => {
                      api.prevent_close();
                      let _ = window.hide();
                  }
                  // 진짜 종료(quit_app/cmd+Q → app.exit): 자식 프로세스 정리.
                  tauri::WindowEvent::Destroyed => {
                      let state = window.state::<AppState>();
                      kill_child(&state.backend_process);
                      kill_child(&state.sidecar_process);
                  }
                  _ => {}
              })
```

- [ ] **Step 4: 빌드 검증**

Run: `cd frontend/src-tauri && cargo build`
Expected: 성공. `match event` 패턴 완전성 OK.

- [ ] **Step 5: 수동 스모크**

Run: dev 실행 후 빨간 X 클릭 → 창 사라지지만 트레이 아이콘 잔존, Rails(13323) 응답 유지(`curl -s 127.0.0.1:13323/up` 또는 health). 트레이 "완전 종료" → 앱·Rails·sidecar 종료.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/src/window_cmd.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(window): quit_app/show_main_window 커맨드 + CloseRequested→hide 재배선"
```

---

### Task 3: 닫기 다이얼로그 (프론트) — 백그라운드/완전종료 + 기억

빨간 X → `onCloseRequested` preventDefault → 모달. cmd+Q는 Task 2의 Destroyed 경로로 자연 종료(가로채지 않음).

**Files:**
- Create: `frontend/src/components/ClosePrompt.tsx`
- Create: `frontend/src/lib/closeAction.ts` (localStorage 헬퍼, 순수 — 테스트 대상)
- Create: `frontend/src/lib/closeAction.test.ts`
- Modify: `frontend/src/App.tsx:218-223` (전역 마운트)

**Interfaces:**
- Produces: `getCloseAction(): 'hide' | 'quit' | null`, `setCloseAction(a: 'hide'|'quit'): void` (localStorage 키 `closeAction`).
- Produces: `<ClosePrompt/>` — 헤드리스+모달. desktop에서만 동작(IS_TAURI && getMode()==='local').

- [ ] **Step 1: closeAction 헬퍼 실패 테스트**

`frontend/src/lib/closeAction.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { getCloseAction, setCloseAction } from './closeAction'

describe('closeAction', () => {
  beforeEach(() => localStorage.clear())
  it('기본값은 null(미설정)', () => {
    expect(getCloseAction()).toBeNull()
  })
  it('set 후 get으로 복원', () => {
    setCloseAction('hide')
    expect(getCloseAction()).toBe('hide')
    setCloseAction('quit')
    expect(getCloseAction()).toBe('quit')
  })
  it('잘못된 값은 null로 취급', () => {
    localStorage.setItem('closeAction', 'garbage')
    expect(getCloseAction()).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/closeAction.test.ts`
Expected: FAIL — `closeAction` 모듈 없음.

- [ ] **Step 3: closeAction 헬퍼 구현**

`frontend/src/lib/closeAction.ts`:
```ts
export type CloseAction = 'hide' | 'quit'
const KEY = 'closeAction'

export function getCloseAction(): CloseAction | null {
  const v = localStorage.getItem(KEY)
  return v === 'hide' || v === 'quit' ? v : null
}

export function setCloseAction(a: CloseAction): void {
  localStorage.setItem(KEY, a)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/closeAction.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: ClosePrompt 컴포넌트 작성**

`frontend/src/components/ClosePrompt.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IS_TAURI, getMode } from '../config'
import { getCloseAction, setCloseAction, type CloseAction } from '../lib/closeAction'

/**
 * 데스크톱 로컬 앱에서 창 닫기(빨간 X)를 가로채 백그라운드/완전종료를 묻는다.
 * 기억된 선택이 있으면 모달 없이 즉시 수행. cmd+Q는 가로채지 않음(자연 종료).
 * RecordingRecovery/ScheduledMeetingWatcher와 같은 전역 마운트, 평소 null 렌더.
 */
export function ClosePrompt() {
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (!IS_TAURI || getMode() !== 'local') return
    let unlisten: (() => void) | undefined
    let disposed = false
    ;(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const un = await win.onCloseRequested(async (event) => {
        event.preventDefault()
        const saved = getCloseAction()
        if (saved === 'hide') return void win.hide()
        if (saved === 'quit') {
          const { invoke } = await import('@tauri-apps/api/core')
          return void invoke('quit_app')
        }
        setOpen(true)
      })
      if (disposed) un()
      else unlisten = un
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const choose = async (action: CloseAction) => {
    if (remember) setCloseAction(action)
    setOpen(false)
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (action === 'hide') await getCurrentWindow().hide()
    else {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('quit_app')
    }
  }

  if (!open) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="창 닫기"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold">또박또박을 어떻게 할까요?</h2>
        <p className="mt-2 text-sm text-gray-600">
          백그라운드로 두면 예약 회의가 시각에 맞춰 자동 시작됩니다.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          다음부터 묻지 않기
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={() => void choose('quit')}
          >
            완전 종료
          </button>
          <button
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
            onClick={() => void choose('hide')}
          >
            백그라운드 유지
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 6: App.tsx에 전역 마운트**

`frontend/src/App.tsx:13` import 옆에:
```tsx
import { ClosePrompt } from './components/ClosePrompt'
```
`:221`의 `<ScheduledMeetingWatcher />` 옆(218-223 모달 영역)에:
```tsx
        <ClosePrompt />
```

- [ ] **Step 7: 빌드 + 회귀**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc 신규 에러 0, vitest 전체 그린(closeAction 3 추가).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ClosePrompt.tsx frontend/src/lib/closeAction.ts frontend/src/lib/closeAction.test.ts frontend/src/App.tsx
git commit -m "feat(window): 닫기 시 백그라운드/완전종료 다이얼로그 + 선택 기억"
```

---

### Task 4: Rust 트리거 계산 (순수 함수 + 단위테스트)

JS `computeScheduleActions`의 시간창 산술을 Rust로 포팅. chrono로 ISO8601 파싱.

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` ([dependencies]에 chrono)
- Create: `frontend/src-tauri/src/scheduler/mod.rs` (또는 `scheduler.rs`)

**Interfaces:**
- Produces:
```rust
pub struct SchedMeeting { pub id: i64, pub scheduled_start_time: Option<String>, pub auto_start_mode: Option<String> }
pub struct TriggerAction { pub meeting_id: i64, pub mode: String } // "auto" | "manual"
pub fn compute_actions(meetings: &[SchedMeeting], now: chrono::DateTime<chrono::Utc>, already: &std::collections::HashSet<i64>) -> Vec<TriggerAction>
```

- [ ] **Step 1: chrono 의존성 추가**

`frontend/src-tauri/Cargo.toml` [dependencies]에:
```toml
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: 실패하는 단위테스트 작성**

`frontend/src-tauri/src/scheduler/mod.rs` (테스트 먼저, 구현 빈 상태):
```rust
use chrono::{DateTime, Utc};
use std::collections::HashSet;

// (여기에 Step 3 타입/함수가 들어감)

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: i64, t: &str, mode: &str) -> SchedMeeting {
        SchedMeeting { id, scheduled_start_time: Some(t.into()), auto_start_mode: Some(mode.into()) }
    }
    fn now(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn auto_fires_at_scheduled_instant() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        let acts = compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &HashSet::new());
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].meeting_id, 1);
        assert_eq!(acts[0].mode, "auto");
    }

    #[test]
    fn auto_not_fire_after_grace_upper_exclusive() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        // +60s 정확히 = 상한 배타 → 발화 안 함
        let acts = compute_actions(&ms, now("2026-06-22T14:31:00.000Z"), &HashSet::new());
        assert!(acts.is_empty());
    }

    #[test]
    fn manual_fires_60s_before() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "manual")];
        let acts = compute_actions(&ms, now("2026-06-22T14:29:00.000Z"), &HashSet::new());
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].mode, "manual");
    }

    #[test]
    fn already_triggered_skipped() {
        let ms = vec![m(1, "2026-06-22T14:30:00.000Z", "auto")];
        let mut seen = HashSet::new();
        seen.insert(1);
        assert!(compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &seen).is_empty());
    }

    #[test]
    fn no_mode_or_no_time_skipped() {
        let ms = vec![
            SchedMeeting { id: 1, scheduled_start_time: None, auto_start_mode: Some("auto".into()) },
            SchedMeeting { id: 2, scheduled_start_time: Some("2026-06-22T14:30:00.000Z".into()), auto_start_mode: None },
        ];
        assert!(compute_actions(&ms, now("2026-06-22T14:30:00.000Z"), &HashSet::new()).is_empty());
    }
}
```

- [ ] **Step 3: 빈 구현으로 실패 확인 → 그 다음 구현**

먼저 구현부를 추가(테스트가 컴파일되도록):
```rust
use serde::Deserialize;

const GRACE_MS: i64 = 60_000;
const MANUAL_LEAD_MS: i64 = 60_000;

#[derive(Debug, Clone, Deserialize)]
pub struct SchedMeeting {
    pub id: i64,
    pub scheduled_start_time: Option<String>,
    pub auto_start_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TriggerAction {
    pub meeting_id: i64,
    pub mode: String,
}

/// JS computeScheduleActions와 동일 규칙. auto:[t, t+60s), manual:[t-60s, t+60s), 상한 배타.
pub fn compute_actions(
    meetings: &[SchedMeeting],
    now: DateTime<Utc>,
    already: &HashSet<i64>,
) -> Vec<TriggerAction> {
    let now_ms = now.timestamp_millis();
    let mut out = Vec::new();
    for m in meetings {
        let mode = match m.auto_start_mode.as_deref() {
            Some(x @ ("auto" | "manual")) => x,
            _ => continue,
        };
        if already.contains(&m.id) {
            continue;
        }
        let Some(ts) = &m.scheduled_start_time else { continue };
        let Ok(parsed) = DateTime::parse_from_rfc3339(ts) else { continue };
        let scheduled_ms = parsed.with_timezone(&Utc).timestamp_millis();
        let lower = if mode == "manual" { scheduled_ms - MANUAL_LEAD_MS } else { scheduled_ms };
        let upper = scheduled_ms + GRACE_MS;
        if now_ms >= lower && now_ms < upper {
            out.push(TriggerAction { meeting_id: m.id, mode: mode.to_string() });
        }
    }
    out
}
```
모듈 선언을 `lib.rs`에 추가:
```rust
#[cfg(desktop)]
mod scheduler;
```

- [ ] **Step 4: 단위테스트 실행**

Run: `cd frontend/src-tauri && cargo test scheduler`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/scheduler/mod.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(scheduler): Rust 트리거 계산 순수함수 + chrono 파싱 단위테스트"
```

---

### Task 5: Rust 폴 루프 + 트리거 시 창 표시 + 이벤트 emit

스케줄러가 60s 폴 → `compute_actions` → 트리거 시 `window.show()`+focus 후 `scheduled-meeting-trigger` emit. 이미 트리거한 id는 기록.

**Files:**
- Modify: `frontend/src-tauri/src/scheduler/mod.rs` (poll 루프 추가)
- Modify: `frontend/src-tauri/src/lib.rs:155-186` (setup에서 desktop tokio task spawn)
- Modify: `frontend/src-tauri/capabilities/default.json` (필요 시 window 권한 — 검증)

**Interfaces:**
- Consumes: `compute_actions`, `SchedMeeting` (Task 4).
- Produces: `scheduler::spawn(app: tauri::AppHandle)` — tokio 폴 루프 시작.
- Emits: `scheduled-meeting-trigger` payload `{ meetingId: i64, mode: String }`.

- [ ] **Step 1: poll 루프 구현**

`scheduler/mod.rs`에 추가(파일 상단 import에 `tauri::{AppHandle, Manager, Emitter}`, `std::sync::Mutex`, `serde::Serialize` 보강):
```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
struct TriggerPayload {
    #[serde(rename = "meetingId")]
    meeting_id: i64,
    mode: String,
}

const SCHED_URL: &str = "http://127.0.0.1:13323/api/v1/meetings/scheduled";
const POLL_SECS: u64 = 60;

#[derive(Deserialize)]
struct ScheduledEnvelope {
    meetings: Vec<SchedMeeting>,
}

/// 데스크톱 전용 백그라운드 스케줄러. 60s마다 loopback(무토큰)으로 예약 목록을 폴하고,
/// 트리거 시각 도달 회의는 메인 창을 표시한 뒤 scheduled-meeting-trigger 를 emit 한다.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let mut already: HashSet<i64> = HashSet::new();
        loop {
            match client.get(SCHED_URL).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(env) = resp.json::<ScheduledEnvelope>().await {
                        let now = Utc::now();
                        for act in compute_actions(&env.meetings, now, &already) {
                            already.insert(act.meeting_id);
                            // 1) 메인 창 먼저 표시(웹뷰·AudioContext 복원)
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            // 2) 프론트로 트리거 emit
                            let _ = app.emit(
                                "scheduled-meeting-trigger",
                                TriggerPayload { meeting_id: act.meeting_id, mode: act.mode },
                            );
                            log::info!("예약 트리거: meeting {}", act.meeting_id);
                        }
                    }
                }
                Ok(resp) => log::warn!("scheduled 폴 비정상 status: {}", resp.status()),
                Err(e) => log::debug!("scheduled 폴 실패(부팅 중/오프라인): {e}"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;
        }
    });
}
```
참고: `Utc`는 chrono. `HashSet`/`Deserialize`는 Task 4에서 이미 import. boot-not-ready는 Err를 debug 로그로 흘리고 다음 폴 재시도로 자연 가드.

- [ ] **Step 2: setup에서 spawn**

`lib.rs` setup()의 desktop 블록(Task 1 트레이 생성 다음)에 추가:
```rust
            #[cfg(desktop)]
            scheduler::spawn(app.handle().clone());
```

- [ ] **Step 3: capability 검증**

`frontend/src-tauri/capabilities/default.json`의 permissions에 `core:default`가 있고, Tauri v2에서 Rust측 `window.show()/hide()/set_focus()`는 capability 불필요(JS측 호출만 `core:window:*` 필요). 프론트(Task 3 ClosePrompt, Task 6)가 JS에서 `getCurrentWindow().hide()/show()`를 쓰므로 명시 추가:
```json
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-close",
```
(`core:default`에 이미 포함될 수 있으나 명시가 안전. 빌드 후 권한 거부 로그 없으면 OK.)

- [ ] **Step 4: 빌드 검증**

Run: `cd frontend/src-tauri && cargo build`
Expected: 성공. `Emitter` trait import로 `app.emit` 해석.

- [ ] **Step 5: 수동 통합 스모크**

가까운 미래(2~3분 후) auto 예약 회의를 만들고 창을 숨긴 뒤 대기 → 시각 도달 시 창이 자동 표시되고 콘솔/로그에 "예약 트리거" + 프론트가 /live로 이동(Task 6 후 완성). 이 태스크 단독으론 emit까지 확인.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/src/scheduler/mod.rs frontend/src-tauri/src/lib.rs frontend/src-tauri/capabilities/default.json
git commit -m "feat(scheduler): loopback 폴 루프 + 트리거 시 창 표시 + scheduled-meeting-trigger emit"
```

---

### Task 6: 프론트 `useScheduledMeetings` 분기 (desktop=이벤트 리스너, web=현행)

데스크톱 로컬은 JS 폴을 끄고 Rust 이벤트만 수신. 웹/서버는 글자 그대로 보존.

**Files:**
- Modify: `frontend/src/hooks/useScheduledMeetings.ts`
- Modify/Create: `frontend/src/hooks/useScheduledMeetings.test.ts` (desktop 분기 케이스 추가)

**Interfaces:**
- Consumes: Rust `scheduled-meeting-trigger` 이벤트 (Task 5).
- Behavior: desktop(`IS_TAURI && getMode()==='local'`) → 이벤트 수신 시 `navigate('/meetings/{id}/live', {state:{autoStart:true}})`. else → 기존 폴 로직 그대로.

- [ ] **Step 1: 실패 테스트 — desktop 분기는 폴하지 않고 이벤트로 발화**

`frontend/src/hooks/useScheduledMeetings.test.ts`에 케이스 추가(기존 mock 골격 재사용; `@tauri-apps/api/event`의 `listen` 모킹):
```ts
// 파일 상단 모킹부에 추가
const listeners: Record<string, (e: { payload: unknown }) => void> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners[name] = cb
    return Promise.resolve(() => { delete listeners[name] })
  },
}))

it('desktop(local): 폴하지 않고 트리거 이벤트로 goLive 한다', async () => {
  vi.doMock('../config', async (orig) => ({
    ...(await orig<typeof import('../config')>()),
    IS_TAURI: true,
    getMode: () => 'local',
  }))
  const { useScheduledMeetings } = await import('./useScheduledMeetings')
  renderHook(() => useScheduledMeetings())
  await flush()
  expect(getScheduledMeetings).not.toHaveBeenCalled() // desktop은 JS 폴 안 함
  listeners['scheduled-meeting-trigger']?.({ payload: { meetingId: 7, mode: 'auto' } })
  await flush()
  expect(navigate).toHaveBeenCalledWith('/meetings/7/live', { state: { autoStart: true } })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/hooks/useScheduledMeetings.test.ts`
Expected: FAIL — desktop은 아직 폴하고 listen 안 함.

- [ ] **Step 3: 훅 분기 구현**

`useScheduledMeetings.ts` `useEffect` 시작부에 desktop 분기를 추가(기존 폴 코드는 else로 유지). import에 `getMode` 추가:
```ts
import { IS_TAURI, getMode } from '../config'
```
`useEffect(() => {` 본문 맨 앞:
```ts
    let cancelled = false

    const goLive = (id: number) => {
      navigate(`/meetings/${id}/live`, { state: { autoStart: true } })
    }

    // 데스크톱 로컬: Rust 스케줄러가 트리거 소유 → JS 폴 비활성, 이벤트만 수신.
    if (IS_TAURI && getMode() === 'local') {
      let unlisten: (() => void) | undefined
      let disposed = false
      ;(async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const un = await listen<{ meetingId: number; mode: 'auto' | 'manual' }>(
          'scheduled-meeting-trigger',
          (e) => {
            if (cancelled) return
            if (pathnameRef.current.includes('/live')) return // 진행 중 세션 보호
            goLive(e.payload.meetingId)
          },
        )
        if (disposed) un()
        else unlisten = un
      })()
      return () => {
        cancelled = true
        disposed = true
        unlisten?.()
      }
    }

    // 이하 기존 웹/서버 폴 로직(변경 없음) ...
```
주의: 기존 본문의 `let cancelled = false` 및 `goLive` 중복 선언을 제거하고 위에서 한 번만 선언(분기 양쪽 공유). 나머지 `handle`/`poll`/`setInterval`/cleanup은 그대로.

- [ ] **Step 4: 테스트 통과 + 웹 회귀 확인**

Run: `cd frontend && npx vitest run src/hooks/useScheduledMeetings.test.ts`
Expected: PASS — 신규 desktop 케이스 + 기존 웹 폴 케이스 모두 그린(웹 분기 불변).

- [ ] **Step 5: 전체 회귀 + 타입체크**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: 신규 TS 에러 0, vitest 전체 그린.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useScheduledMeetings.ts frontend/src/hooks/useScheduledMeetings.test.ts
git commit -m "feat(scheduler): 데스크톱 예약은 Rust 트리거 이벤트 수신(웹 폴 경로 불변)"
```

---

### Task 7: Power assertion (caffeinate) + 녹음 상태 통지

`caffeinate -is` 자식을 (a) 예약 T-120s~회의, (b) 녹음 활성 중 보유. 녹음 on/off는 프론트가 `set_recording(active)`로 통지.

**Files:**
- Create: `frontend/src-tauri/src/assertion.rs`
- Modify: `frontend/src-tauri/src/lib.rs` (state 관리 + 커맨드 등록 + Destroyed 누수 정리)
- Modify: `frontend/src-tauri/src/scheduler/mod.rs` (T-120s lead에서 acquire)
- Modify: `frontend/src/hooks/useLiveRecording.ts` (isActive 토글 시 invoke)

**Interfaces:**
- Produces: `assertion::AssertionState` (managed; `Mutex<Option<Child>>`), `assertion::acquire(state)`, `assertion::release(state)`.
- Produces: `#[tauri::command] assertion::set_recording(active: bool, state: State<AssertionState>)`.

- [ ] **Step 1: assertion 모듈 작성**

`frontend/src-tauri/src/assertion.rs`:
```rust
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct AssertionState(pub Mutex<Option<Child>>);

/// caffeinate -is 자식을 보유(이미 있으면 no-op). 유휴/시스템 슬립 차단(디스플레이는 미차단).
pub fn acquire(state: &AssertionState) {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return;
    }
    match Command::new("caffeinate").arg("-is").spawn() {
        Ok(child) => *guard = Some(child),
        Err(e) => log::warn!("caffeinate 시작 실패: {e}"),
    }
}

/// 보유 중인 caffeinate 자식을 종료.
pub fn release(state: &AssertionState) {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// 프론트의 녹음 on/off 통지. 녹음 중 슬립 차단.
#[tauri::command]
pub fn set_recording(active: bool, state: State<'_, AssertionState>) {
    if active {
        acquire(&state);
    } else {
        release(&state);
    }
}
```

- [ ] **Step 2: lib.rs 배선**

모듈 선언 `#[cfg(desktop)] mod assertion;`. desktop `.manage(...)`에 추가:
```rust
                  .manage(assertion::AssertionState::default())
```
generate_handler!에 `assertion::set_recording,` 추가. `Destroyed` 핸들러(Task 2 수정본)에 누수 정리 추가:
```rust
                      assertion::release(&window.state::<assertion::AssertionState>());
```

- [ ] **Step 3: 스케줄러 T-120s lead에서 acquire**

`scheduler/mod.rs`의 트리거 직전(또는 별도 lead 계산)에서, 트리거 시점에 acquire 호출(최소 구현: 트리거 시 acquire, 녹음 종료 set_recording(false)로 release). T-120s 선행 acquire는 폴 주기(60s) 내 자연 도달:
```rust
                            assertion::acquire(&app.state::<assertion::AssertionState>());
```
(트리거 시 acquire → 녹음 시작 → 종료 시 set_recording(false)가 release. lead는 폴 간격상 충분.)

- [ ] **Step 4: 프론트 녹음 토글 통지**

`useLiveRecording.ts`에서 `isActive`(status==='recording') 변화 시 invoke. 기존 pause/resume invoke 관용구(line 350) 옆에 useEffect 추가:
```ts
  useEffect(() => {
    if (!IS_TAURI) return
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_recording', { active: isActive }))
      .catch(() => {})
  }, [isActive])
```
(`IS_TAURI`는 이미 import됨. 없으면 `import { IS_TAURI } from '../config'` 추가.)

- [ ] **Step 5: 빌드 + 회귀**

Run: `cd frontend/src-tauri && cargo build && cd .. && npx tsc --noEmit && npm test`
Expected: 빌드 성공, 프론트 그린.

- [ ] **Step 6: 수동 스모크**

녹음 시작 → `pgrep caffeinate` 존재 확인. 녹음 종료 → caffeinate 사라짐. 앱 완전 종료 시에도 잔존 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src-tauri/src/assertion.rs frontend/src-tauri/src/lib.rs frontend/src-tauri/src/scheduler/mod.rs frontend/src/hooks/useLiveRecording.ts
git commit -m "feat(power): caffeinate 유휴슬립 차단(녹음 중·예약 트리거) + 누수 정리"
```

---

### Task 8: sidecar `POST /warmup` + Rust T-60s 호출

sidecar에 워밍업 엔드포인트(2초 무음 추론)를 추가하고, 스케줄러가 트리거 60s 전 호출.

**Files:**
- Modify: `sidecar/app/main.py` (또는 `sidecar/app/routers/health.py`) — `/warmup` 라우트
- Create: `sidecar/tests/test_warmup.py`
- Modify: `frontend/src-tauri/src/scheduler/mod.rs` (T-60s warmup 호출)

**Interfaces:**
- Produces: `POST /warmup` → 200 `{ "warmed": true }`. 내부에서 `app.state.stt_adapter`를 2초 무음으로 1회 추론(routers/stt.py의 `/transcribe`가 어댑터를 호출하는 동일 방식).
- Consumes(Rust): `reqwest POST http://127.0.0.1:13324/warmup`.

- [ ] **Step 1: 실패하는 pytest 작성**

`sidecar/tests/test_warmup.py` (기존 sidecar 테스트의 TestClient + adapter 목 패턴을 따른다):
```python
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock
from app.main import app

def test_warmup_runs_adapter_once_and_returns_200():
    fake = AsyncMock()
    fake.transcribe = AsyncMock(return_value=type("R", (), {"segments": []})())
    app.state.stt_adapter = fake
    client = TestClient(app)
    res = client.post("/warmup")
    assert res.status_code == 200
    assert res.json()["warmed"] is True
    fake.transcribe.assert_awaited()  # 어댑터 추론 1회 호출
```
주의: 실제 어댑터 메서드명/시그니처는 `routers/stt.py`의 `/transcribe` 핸들러가 호출하는 것과 **동일하게 맞춘다**(구현 시 그 호출부를 그대로 모방). 위 목은 `transcribe(bytes)` 가정 — 실제 메서드가 다르면 그 이름으로 교체.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd sidecar && uv run pytest tests/test_warmup.py -v`
Expected: FAIL — `/warmup` 404.

- [ ] **Step 3: /warmup 라우트 구현**

`sidecar/app/main.py`(또는 health 라우터)에 추가. `routers/stt.py`의 `/transcribe`가 어댑터를 호출하는 코드를 참조해 동일 호출로 2초 무음(16kHz int16 zeros = 64000 bytes)을 추론:
```python
@app.post("/warmup")
async def warmup():
    """예약 회의 1분 전 호출. 2초 무음으로 STT 어댑터를 1회 추론해
    커널 컴파일(MLX/CUDA lazy eval)을 끝내고 모델 로드를 보장한다."""
    adapter = app.state.stt_adapter
    silence = b"\x00" * 64000  # 2s @ 16kHz int16 mono
    try:
        await adapter.transcribe(silence)  # /transcribe와 동일 호출 시그니처로 맞출 것
    except Exception as e:  # noqa: BLE001
        logger.warning("[warmup] 추론 실패(무시): %s", e)
    return {"warmed": True}
```
(`logger`는 main.py 기존 로거 재사용. 어댑터 호출 시그니처는 stt.py와 일치시킨다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd sidecar && uv run pytest tests/test_warmup.py -v`
Expected: PASS.

- [ ] **Step 5: Rust T-60s warmup 호출**

`scheduler/mod.rs` — 트리거 60s 전 회의에 대해 `POST /warmup`. 최소 구현: compute_actions와 별도로, "다음 60s 내 시작하는 예약"을 판정해 한 번 호출(이미 warm 요청한 id 기록). 또는 트리거 직전 acquire 옆에서 호출:
```rust
const WARMUP_URL: &str = "http://127.0.0.1:13324/warmup";
// 폴 루프 내, lead 판정(scheduled - now <= 60s && > 0)인 회의에 대해 1회:
let _ = client.post(WARMUP_URL).send().await; // 실패는 무시(로그만), 녹음 시 자연 로드
```
warmup 전송 id는 `warmed: HashSet<i64>`로 중복 방지. 별도 lead 판정 헬퍼 `fn warmup_due(meetings, now) -> Vec<i64>`를 순수 함수로 분리하면 단위테스트 가능(선택).

- [ ] **Step 6: 빌드 + 회귀**

Run: `cd frontend/src-tauri && cargo build && cd ../../sidecar && uv run pytest -q`
Expected: 빌드 성공, sidecar 테스트 그린.

- [ ] **Step 7: Commit**

```bash
git add sidecar/app/main.py sidecar/tests/test_warmup.py frontend/src-tauri/src/scheduler/mod.rs
git commit -m "feat(warmup): sidecar POST /warmup(2초 무음 추론) + 예약 T-60s 워밍업 호출"
```

---

### Task 9: Notification 플러그인 + "녹음 중" 알림

백그라운드 자동시작 시 OS 알림 "녹음 중: <회의명>". 알림 클릭 시 창 표시(show_main_window).

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (tauri-plugin-notification)
- Modify: `frontend/src-tauri/src/lib.rs:57-60` (plugin 등록)
- Modify: `frontend/src-tauri/capabilities/default.json` (notification 권한)
- Modify: `frontend/package.json` (@tauri-apps/plugin-notification) + `frontend/vite.config.ts` (테스트 stub alias 필요 시)
- Modify: `frontend/src/hooks/useScheduledMeetings.ts` (트리거 이벤트 수신 시 알림)

**Interfaces:**
- Consumes: `scheduled-meeting-trigger` 이벤트(Task 6 핸들러)에서 알림 발송 + show_main_window.

- [ ] **Step 1: Rust 플러그인 추가**

`Cargo.toml` [dependencies]:
```toml
tauri-plugin-notification = "2"
```
`lib.rs:57-60` 플러그인 체인에:
```rust
        .plugin(tauri_plugin_notification::init())
```

- [ ] **Step 2: capability 추가**

`capabilities/default.json` permissions에:
```json
    "notification:default",
```

- [ ] **Step 3: npm 패키지 + 테스트 stub**

`frontend/package.json` dependencies에 `"@tauri-apps/plugin-notification": "^2"` 추가 후 `cd frontend && npm install`. 테스트에서 import 깨지면 `vite.config.ts:15-18` deep-link stub 패턴을 따라 alias stub 또는 해당 테스트에서 `vi.mock('@tauri-apps/plugin-notification', () => ({ ... }))`.

- [ ] **Step 4: 트리거 시 알림 + 창 표시**

`useScheduledMeetings.ts`의 desktop 이벤트 핸들러(Task 6)에서 goLive 직전/직후:
```ts
            // 백그라운드 자동시작 알림 + 창 표시
            import('@tauri-apps/api/core')
              .then(({ invoke }) => invoke('show_main_window'))
              .catch(() => {})
            import('@tauri-apps/plugin-notification')
              .then(async ({ isPermissionGranted, requestPermission, sendNotification }) => {
                let granted = await isPermissionGranted()
                if (!granted) granted = (await requestPermission()) === 'granted'
                if (granted) sendNotification({ title: '또박또박', body: '녹음 중: 예약 회의' })
              })
              .catch(() => {})
```
(회의명은 Rust 페이로드에 title이 없으므로 "예약 회의"로 시작. 회의명 표시가 필요하면 Task 5 페이로드에 title 추가 — 별도 후속.)

- [ ] **Step 5: 빌드 + 회귀**

Run: `cd frontend/src-tauri && cargo build && cd .. && npx tsc --noEmit && npm test`
Expected: 빌드 성공, 프론트 그린(필요 시 stub 적용).

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/lib.rs frontend/src-tauri/capabilities/default.json frontend/package.json frontend/package-lock.json frontend/src/hooks/useScheduledMeetings.ts
git commit -m "feat(notify): 백그라운드 예약 자동시작 시 OS 알림 + 창 표시"
```

---

### Task 10: (옵션) 자동시작 토글 — 기본 OFF

로그인 시 자동 시작. 기본 비활성, 설정 토글 1개.

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (tauri-plugin-autostart)
- Modify: `frontend/src-tauri/src/lib.rs` (plugin 등록)
- Modify: `frontend/src-tauri/capabilities/default.json` (autostart 권한)
- Modify: `frontend/package.json` (@tauri-apps/plugin-autostart)
- Modify: 설정 UI — `frontend/src/components/settings/` 내 적절한 탭(예: MeetingSettingsTab) + 토글

**Interfaces:**
- 설정 토글 ON → `enable()`, OFF → `disable()` (`@tauri-apps/plugin-autostart`).

- [ ] **Step 1: Rust 플러그인 추가**

`Cargo.toml`:
```toml
tauri-plugin-autostart = "2"
```
`lib.rs` 플러그인 체인(desktop만):
```rust
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
```
(plugin 체인이 데스크톱·모바일 공유면 `#[cfg(desktop)]`로 감싸 desktop 전용 등록.)

- [ ] **Step 2: capability + npm**

`capabilities/default.json`에 `"autostart:default"`. `frontend/package.json`에 `"@tauri-apps/plugin-autostart": "^2"` + `npm install`.

- [ ] **Step 3: 설정 토글 UI**

설정 탭에 토글 추가. ON/OFF 시:
```ts
const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart')
on ? await enable() : await disable()
```
초기 상태는 `isEnabled()`로 동기화. IS_TAURI && local에서만 노출(기존 CLI 프리셋 게이트 패턴 참조: getMode()==='local').

- [ ] **Step 4: 빌드 + 회귀**

Run: `cd frontend/src-tauri && cargo build && cd .. && npx tsc --noEmit && npm test`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(autostart): 로그인 시 자동 시작 토글(기본 OFF, 로컬 데스크톱만)"
```

---

### Task 11: 무음 5분 자동완료 (빈 회의 정리, 순수 함수 + 배선)

녹음 중 연속 무음 5분이면 `handleStop()`. show-at-trigger로 suspend 가짜무음이 없어 진짜 빈 회의만 종료.

**Files:**
- Create: `frontend/src/lib/silenceAutoComplete.ts` (순수 카운터)
- Create: `frontend/src/lib/silenceAutoComplete.test.ts`
- Modify: `frontend/src/hooks/useLiveRecording.ts` (PCM/RMS 콜백에서 카운터 누적 → 임계 시 handleStop)

**Interfaces:**
- Produces:
```ts
export interface SilenceState { silentMs: number }
export function newSilenceState(): SilenceState
/** chunkMs: 이 청크 길이, hasSound: RMS가 게이트 초과(유음). 반환=자동완료해야 하면 true. */
export function tickSilence(s: SilenceState, chunkMs: number, hasSound: boolean, thresholdMs?: number): boolean
```

- [ ] **Step 1: 실패 테스트**

`frontend/src/lib/silenceAutoComplete.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { newSilenceState, tickSilence } from './silenceAutoComplete'

const FIVE_MIN = 5 * 60_000

describe('tickSilence', () => {
  it('연속 무음 5분 도달 시 true', () => {
    const s = newSilenceState()
    let fired = false
    for (let t = 0; t < FIVE_MIN; t += 1000) fired = tickSilence(s, 1000, false)
    expect(fired).toBe(true)
  })
  it('5분 직전까지는 false', () => {
    const s = newSilenceState()
    let fired = false
    for (let t = 0; t < FIVE_MIN - 1000; t += 1000) fired = tickSilence(s, 1000, false)
    expect(fired).toBe(false)
  })
  it('유음 1회로 카운터 리셋', () => {
    const s = newSilenceState()
    for (let t = 0; t < FIVE_MIN - 1000; t += 1000) tickSilence(s, 1000, false)
    tickSilence(s, 1000, true) // 유음 → 리셋
    expect(s.silentMs).toBe(0)
    expect(tickSilence(s, 1000, false)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/silenceAutoComplete.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`frontend/src/lib/silenceAutoComplete.ts`:
```ts
const DEFAULT_THRESHOLD_MS = 5 * 60_000

export interface SilenceState {
  silentMs: number
  done: boolean
}

export function newSilenceState(): SilenceState {
  return { silentMs: 0, done: false }
}

/** 무음 청크 누적, 유음이면 리셋. 임계 최초 도달 시에만 true(한 번). */
export function tickSilence(
  s: SilenceState,
  chunkMs: number,
  hasSound: boolean,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): boolean {
  if (hasSound) {
    s.silentMs = 0
    return false
  }
  if (s.done) return false
  s.silentMs += chunkMs
  if (s.silentMs >= thresholdMs) {
    s.done = true
    return true
  }
  return false
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/silenceAutoComplete.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: useLiveRecording 배선**

`useLiveRecording.ts`의 PCM/RMS 처리 콜백(RMS_GATE로 유음 판정하는 지점)에서 카운터 누적. 녹음 시작 시 `newSilenceState()`로 초기화, 청크마다:
```ts
    if (tickSilence(silenceRef.current, chunkMs, rms >= RMS_GATE)) {
      handleStop() // 빈 회의 자동완료
    }
```
(`silenceRef`는 `useRef(newSilenceState())`. `chunkMs`·`rms`·`RMS_GATE`는 기존 STT 게이트 경로의 값 재사용. handleStop은 동일 훅 내 핸들러.)

- [ ] **Step 6: 회귀**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: 신규 TS 에러 0, 전체 그린.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/silenceAutoComplete.ts frontend/src/lib/silenceAutoComplete.test.ts frontend/src/hooks/useLiveRecording.ts
git commit -m "feat(recording): 무음 5분 자동완료(빈 예약 회의 정리)"
```

---

### Task 12: 수동 E2E 체크리스트 (기기 검증)

코드 변경 없음. 빌드한 앱(또는 dev)에서 아래를 실측하고 결과를 기록.

**Files:**
- Create: `docs/superpowers/plans/2026-06-22-tauri-background-tray-e2e.md` (결과 기록)

- [ ] **Step 1: 트레이/닫기**
  1. 빨간 X → 모달 → "백그라운드 유지" → 창 숨김, 트레이 잔존, Rails 응답 유지.
  2. 트레이 좌클릭 → 창 복원. 트레이 "완전 종료" → 앱·Rails·sidecar 종료, `pgrep caffeinate`=0.
  3. "다음부터 묻지 않기" 체크 후 닫기 → 다음 닫기는 모달 없이 즉시 수행.
  4. cmd+Q → 정리 후 종료.

- [ ] **Step 2: 예약 백그라운드 자동시작**
  1. 2~3분 후 auto 예약 생성 → 창 숨김(백그라운드) → 시각 도달 시 **창 자동 표시 + 녹음 시작 + OS 알림 "녹음 중"**. 첫 전사 즉시(워밍업 효과).
  2. manual 예약 → 60s 전 동작 확인.
  3. 예약 시작 후 말하지 않고 방치 → **무음 5분 후 자동 완료**.

- [ ] **Step 3: 슬립**
  1. 디스플레이 슬립(화면만 끔, 시스템 awake) + 예약 → 실행.
  2. 유휴 방치(시스템 슬립 임박) + 예약 임박 → `pmset -g assertions`로 PreventUserIdleSystemSleep 확인, 안 잠들고 실행.
  3. (범위 밖 확인) 뚜껑 닫음 딥슬립 → 미실행, 회의는 "놓친 예약"에 pending 잔존.

- [ ] **Step 4: 회귀(웹 경로 불변)**
  - 웹 브라우저에서 예약 자동시작이 기존대로(confirm 다이얼로그) 동작.

- [ ] **Step 5: 결과 기록 + Commit**

```bash
git add docs/superpowers/plans/2026-06-22-tauri-background-tray-e2e.md
git commit -m "docs(e2e): Tauri 백그라운드/예약 자동시작 기기 검증 결과"
```

---

## 부록: 컴포넌트↔태스크 매핑 (spec §4)

| spec | 컴포넌트 | 태스크 |
|------|----------|--------|
| 4.1 | 트레이 아이콘 + show/hide | Task 1 |
| 4.2 | 닫기 가로채기 + quit_app | Task 2(Rust) + Task 3(프론트) |
| 4.3 | Rust 스케줄러(폴·계산·트리거 시 창 표시·emit) | Task 4(계산) + Task 5(폴/emit) + Task 6(프론트 수신) |
| 4.4 | Power assertion | Task 7 |
| 4.5 | 알림 + 자동시작 | Task 9(알림) + Task 10(자동시작) |
| 4.6 | 무음 자동완료 | Task 11 |
| 4.7 | 모델 프리로드 | Task 8 |
| §8 E2E | 수동 검증 | Task 12 |
