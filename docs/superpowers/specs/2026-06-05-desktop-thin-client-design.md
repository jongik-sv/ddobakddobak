# 또박또박 데스크탑 → 순수 씬클라이언트 전환 설계

작성일: 2026-06-05
상태: 설계 승인 대기

## 1. 배경 / 목표

기존 데스크탑 앱(Tauri v2, Phase 0–5)은 Rails 백엔드 + Python sidecar를 통째로
번들에 임베딩하고, Rust(`lib.rs`)가 이 둘을 로컬 프로세스로 spawn/kill 하는
**올인원** 구조였다. 그 사이 프로젝트가 "내 컴퓨터 = 서버 + 클라이언트(Android/PC)"
멀티클라이언트 방향으로 바뀌었다.

**목표:** 데스크탑 앱을 **얇은 계층 클라이언트**로 전환한다.
- 서버(Rails + sidecar)는 **따로 배포**한다(LAN 또는 원격). 앱은 임베딩하지 않는다.
- 앱은 사용자가 지정한 서버에 HTTP/WS로만 붙는다(= 항상 server 모드).
- 안드로이드 씬클라이언트 경로(`ServerSetup` 스캔/서버목록/로그인)를 데스크탑에서 재사용한다.
- **모든 데스크탑 플랫폼을 씬클라이언트로 통일**한다(macOS 올인원 제거).

**타깃 플랫폼:**
- Windows (CI 빌드 — 개발 호스트가 macOS라 로컬 .exe 생성 불가, GitHub Actions windows-latest 경유)
- macOS (로컬 + CI 빌드 — 다른 맥에서 클라이언트로 내 서버에 접속)

**전제 (Preconditions) — 중요:**
삭제하는 올인원 Rust는 **서버 런처 역할도** 했다(Rails+sidecar를 직접 spawn).
씬클라 전환 후 앱은 서버를 **띄우지 않는다** → 켜진 서버가 없으면 앱은 빈 껍데기다.
따라서 다음이 **별도로** 보장돼야 앱이 실제로 쓸 수 있다(이 spec 범위 밖, 의존 항목):
- 서버 머신에서 Rails+sidecar를 띄우는 **수단**(최소 수동 실행 스크립트, 예: `dev.sh`/
  `bin/rails server -b 0.0.0.0 -p 13323` + sidecar). "따로 배포"가 "런처 있음"을 자동 보장하지 않음.
- 서버가 LAN에 노출(0.0.0.0 바인드) + 클라이언트와 동일 서브넷(또는 원격 도달 경로).
- "완전 오프라인" 사용은 온디바이스 회의(`/local-meetings`)로만 가능(서버 불필요).

## 2. 아키텍처

```
[전]
데스크탑 앱
 ├─ React UI
 ├─ Rust 오케스트레이터: Rails(3001) + sidecar(8000) spawn/kill, 환경체크/의존성설치
 └─ 번들 리소스: backend/* + sidecar/* + config.yaml  (시스템 Ruby/Python 필요)

[후]
데스크탑 앱 (얇은 계층)               별도 배포 서버
 ├─ React UI                         ├─ Rails + sidecar
 └─ 얇은 Rust: scan_lan_servers,     └─ (LAN 또는 원격, 사용자가 직접 운영)
    deep-link, log
        │  HTTP /api/v1, WS /cable
        └──────────────────────────►
```

앱은 부팅 시 server 모드로 고정되고, 서버 주소가 없으면 `ServerSetup`(주소 입력/스캔/
저장서버 선택)을 띄운 뒤 `AuthGuard`가 로그인을 강제한다.

## 3. 결정 사항 (브레인스토밍 확정)

| # | 결정 | 값 |
|---|------|-----|
| 1 | 앱 구조 | 순수 씬클라이언트 (서버 임베딩 없음) |
| 2 | 타깃 OS | Windows 우선 + macOS, 둘 다 씬클라 |
| 3 | macOS 올인원 | **완전 삭제** (코드 + 번들 리소스) |
| 4 | 오프라인 탈출구 | 데스크탑에도 **노출**(서버 없이 온디바이스 회의 진입) |
| 5 | 빌드 | Windows = CI, macOS = 로컬 + CI |

## 4. 변경 표면

### 4.1 Rust (`frontend/src-tauri/`)

`lib.rs`(964줄)에서 임베딩 오케스트레이션을 **제거**한다.

- **삭제 대상 (Tauri 커맨드):** `check_environment`, `check_first_run`,
  `run_initial_setup`, `start_services`, `stop_services`, `check_health`.
- **삭제 대상 (지원 함수):** `resolve_shell_path`, `refresh_path`,
  `rbenv_real_bin_dir`, `which`, `get_version`, `tool_command`, `make_command`,
  `is_ruby_tool`, `run_cmd_with_tools`, `run_shell_script`, `is_port_open`,
  `emit_progress`, `kill_child`, `detect_project_dir`, `work_dir`,
  `discover_tools`, `sync_resources_to_data`, `copy_dir_recursive`,
  그리고 관련 `ToolPaths`/`EnvironmentStatus` 타입, 프로세스 상태(Mutex<Child>) 보관.
- **유지 대상:** `scan_lan_servers`(LAN /24 스캔, `#[cfg(desktop)]`), deep-link 플러그인,
  log 플러그인, shell/fs 플러그인(필요한 것만). `invoke_handler` 등록 목록을
  유지 커맨드만 남기도록 정리.
- `Cargo.toml`: 오케스트레이션 전용 의존성 정리(`dirs` 등 더 안 쓰면 제거).
- **app 종료 훅:** 서비스 kill 로직 제거(임베딩 프로세스가 없으므로 불필요).

`tauri.conf.json`:
- `bundle.resources`에서 backend/sidecar/config.yaml 항목 **전부 제거**.
  → 번들 크기 수 MB, 시스템 Ruby/Python 의존 소멸.
  - ※ `config.yaml` 제거 안전성 확인됨: 프론트는 `config.ts:3`에서
    `import configYaml from '../../config.yaml?raw'`(Vite 빌드타임 임포트)로 읽어
    dist에 문자열로 박는다. 런타임 리소스 디렉토리를 읽지 않으므로 빼도 동작 영향 없다.
- Windows 번들 타깃에 `nsis` 포함(설치 파일). 기존 매트릭스는 `targets: "all"` 유지 가능.

### 4.2 Frontend (`frontend/src/`)

- `config.ts`
  - `getMode()` → 항상 `'server'` 반환(웹/모바일/데스크탑 통일).
  - local 분기(`getApiBaseUrl`/`getWsUrl`의 `127.0.0.1:13323`, `getServerKey`의 `'local'`)
    죽은 코드 정리.
  - `hasMode`/`clearMode`/`getServerUrl`/`getDefaultServerUrl`는 서버 재선택용으로 유지.
- `components/SetupGate.tsx`
  - `'local_setup'` 게이트 + `SetupPage` 분기 **제거**.
  - 흐름: 서버 주소 없음 → `ServerSetup` → 완료 시 reload → `ready`(`AuthGuard`가 로그인 처리).
  - 오프라인 탈출구 "서버 없이 시작 →" 게이트 조건을 `IS_TAURI && IS_MOBILE` →
    `IS_TAURI`로 넓혀 데스크탑에도 노출.
- `components/auth/ServerSetup.tsx`
  - `ServerModeSelector`(로컬/서버 토글) 렌더 **제거** → 모든 환경이 "서버 주소만"
    (모바일과 동일 UX). `mode` state는 항상 `'server'`로 단순화, `handleComplete`의
    local 분기 제거.
- 죽은 local-mode 권한 분기 정리(보안상 **강화**):
  - `components/layout/Sidebar.tsx`: `canManageUsers`에서 `getMode()==='local'` 가지 제거
    → 실제 `admin`만(+`!IS_MOBILE`).
  - `pages/MeetingLivePage.tsx`: `canManageTemplates`에서 `getMode()==='local'` 가지 제거
    → 실제 `admin`만.
  - `components/settings/SettingsContent.tsx`: `isLocalMode` 항상 false →
    분기 정리(비밀번호 섹션 표시 등).
  - `AuthGuard`는 항상 로그인 강제(local 우회 경로 소멸).
- `pages/SetupPage.tsx`(임베딩 설치 UI) + 관련 테스트 **삭제**.
- `ServerModeSelector.tsx` 미사용화 시 함께 정리.

> **온디바이스 STT / 오프라인 회의(`/local-meetings`)는 그대로 유지.** 이것은 server/local
> "모드"(백엔드 위치)와 무관한 **클라이언트측 오프라인 기능**이라 씬클라 전환의 영향을 받지 않는다.

### 4.3 CI (`.github/workflows/build.yml`)

- 이미 4플랫폼 매트릭스(macOS arm64/x64, Windows x64, Linux x64) + `tauri-action@v0` +
  v* 태그 시 GitHub Release(draft)가 **존재**한다.
- 씬클라 전환 후 backend 리소스가 사라지므로 빌드가 더 단순/가벼워진다. 구조 변경 불필요,
  산출물(.exe/.msi/.dmg/.app) 그대로.
- 코드서명은 v1 범위 밖(미서명 → Windows SmartScreen 경고). 후속.

## 5. 리스크 / 검증 (구현 plan에 검증 단계로 편입)

1. **mixed-content / ATS (최우선).** 데스크탑 webview가 평문 http LAN 서버를 직접
   호출 가능한지 확인한다.
   - Windows WebView2: 앱 origin `http://tauri.localhost` → http 서버 호출은 동일 스킴이라
     통과 가능성이 높다.
   - macOS WKWebView: 앱 origin `tauri://localhost` + ATS가 평문 http를 막을 수 있다.
     필요 시 `Info.plist`에 ATS 예외(`NSAppTransportSecurity` →
     `NSAllowsLocalNetworking` 또는 LAN 한정 예외)를 추가한다.
   - **검증 절차:** 로컬 macOS 빌드로 실제 원격 서버 도달 테스트 → 막히면 ATS 예외 추가
     → 그래도 막히면 모바일 native `probe_url`/loopback bridge를 데스크탑에도 재사용.
2. **Windows 빌드.** 로컬 불가 → CI(windows-latest) 의존. `tauri-action` 표준 경로라
   안정적. workflow_dispatch로 수동 트리거해 산출물 확보.
3. **죽은 코드 제거 회귀.** local-mode 분기를 제거하면서 server 경로가 모든 호출처에서
   정상인지 확인(설정/사이드바/권한/회의). 기존 테스트 갱신으로 커버.

## 6. 테스트 전략

- **단위(vitest):**
  - `config.test.ts` — `getMode()` 항상 `'server'`.
  - `SetupGate.test.tsx` — local_setup 분기 제거, server→ready 흐름, 오프라인 탈출구 노출.
  - `ServerSetup.test.tsx` — 토글 제거(항상 서버 주소 입력), 스캔/저장서버/헬스체크.
  - 영향받는 권한 컴포넌트 테스트(Sidebar 등) 갱신.
- **빌드:** `npm run build`(vite) 통과 + 로컬 `npx tauri build`(macOS) 통과 +
  CI 매트릭스 green.
- **E2E(수동):**
  1. macOS 앱 → 다른 맥에서 띄움 → 서버 스캔/주소 입력 → 로그인 → 회의 목록/녹음.
  2. Windows 산출물 설치 → 서버 연결 → 로그인 → 동작.
  3. 서버 없이 "오프라인으로 시작" → `/local-meetings` 온디바이스 회의 진입.

## 7. Out of scope (YAGNI)

- 자동 업데이트(updater).
- 코드서명 / 공증(Windows Authenticode, macOS notarization).
- 트레이 아이콘 / 백그라운드 상주.
- 서버측 배포 자동화(별도 작업).
- 명함 업로드 등 신규 기능(별도 spec/세션).

## 8. 영향받는 파일 요약

| 영역 | 파일 | 변경 |
|------|------|------|
| Rust | `src-tauri/src/lib.rs` | 오케스트레이션 제거, 씬클라 커맨드만 유지 |
| Rust | `src-tauri/src/main.rs` | 데스크탑 진입 정리 |
| Rust | `src-tauri/Cargo.toml` | 미사용 의존성 정리 |
| Conf | `src-tauri/tauri.conf.json` | `bundle.resources` 제거, Windows nsis |
| Conf | `src-tauri/Info.plist` | (필요 시) macOS ATS 예외 |
| FE | `src/config.ts` | `getMode` 항상 server, local 죽은코드 정리 |
| FE | `src/components/SetupGate.tsx` | local_setup 제거, 오프라인 탈출구 데스크탑 노출 |
| FE | `src/components/auth/ServerSetup.tsx` | 모드 토글 제거 |
| FE | `src/components/auth/ServerModeSelector.tsx` | 미사용 정리 |
| FE | `src/pages/SetupPage.tsx` | 삭제 |
| FE | `src/components/layout/Sidebar.tsx` | local-mode 권한가지 제거 |
| FE | `src/pages/MeetingLivePage.tsx` | local-mode 권한가지 제거 |
| FE | `src/components/settings/SettingsContent.tsx` | isLocalMode 분기 정리 |
| CI | `.github/workflows/build.yml` | (구조 유지, 검증) |
