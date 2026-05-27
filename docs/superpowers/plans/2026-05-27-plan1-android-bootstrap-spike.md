# 플랜 1: Tauri Android 부트스트랩 + 연결 스파이크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 또박또박 React 프론트엔드를 Tauri 안드로이드 타깃으로 빌드해 실기기에서 띄우고, "LAN 서버에 평문 http로 붙어 마이크(getUserMedia)+API+WebSocket이 인증서 없이 동작한다"는 아키텍처 핵심 가정을 검증한다.

**Architecture:** 모바일은 백엔드를 로컬 실행할 수 없으므로 서버모드(서버 URL) 클라이언트로 동작한다. 데스크톱 전용 Rust 코드(네이티브 오디오 캡처 `cpal`/`screencapturekit`, 프로세스 오케스트레이션)는 `cfg` 게이팅으로 모바일 빌드에서 제외한다. UI/네트워킹은 기존 웹 경로(getUserMedia + ActionCable)를 그대로 재사용한다.

**Tech Stack:** Tauri v2.10, Rust(android targets), Android SDK/NDK/JDK17, React+Vite(기존), ActionCable.

> 이 플랜은 빌드/인프라 + 수동 검증 성격이 강해 일부 단계는 고전적 red-green 대신 "명령 실행 → 기대 출력 확인"을 검증으로 사용한다.

---

## 전제 / 컨텍스트

- 작업 디렉토리: `/Users/jji/project/ddobakddobak/frontend/src-tauri`
- 서버(이 맥북): Rails `http://<LAN_IP>:13323`, 서버 LAN_IP 예시 `10.110.14.219` (변동 시 `ipconfig getifaddr en0`).
- 현재 `Cargo.toml`: `cpal`(line 32) 무조건 의존, `screencapturekit`(line 35-36) macOS 한정.
- 현재 `src/lib.rs`: `mod audio;`(line 1), 데스크톱 오케스트레이션 커맨드 + `audio::*` 커맨드가 `invoke_handler`에 등록(line 754-770), `.manage(audio::...)`(line 752-753), `.on_window_event`가 `AppState` 접근(line 779-785).
- 백엔드 ActionCable은 어제 작업으로 development에서 `disable_request_forgery_protection = true` 적용됨(폰 origin WS 허용).

## File Structure

- Modify: `frontend/src-tauri/Cargo.toml` — 오디오 전용 크레이트를 비-모바일 타깃으로 게이팅
- Modify: `frontend/src-tauri/src/lib.rs` — `mod audio` 및 데스크톱 상태/커맨드/윈도우이벤트를 `cfg(desktop)`로 분리, 모바일은 최소 핸들러
- Create: `frontend/src-tauri/gen/android/**` — `tauri android init` 산출물(자동 생성)
- Modify(가능): `frontend/.cargo/config.toml` 또는 셸 프로파일 — Android 환경변수 (수동 단계)
- Create: `docs/superpowers/notes/2026-05-27-android-spike-results.md` — 스파이크 결과 기록

---

## Task 1: Android 빌드 환경 설치 (JDK17 + SDK + NDK)

**Files:** 없음(시스템 설치) — 셸 프로파일에 환경변수 추가

- [ ] **Step 1: JDK 17 설치**

Run:
```bash
brew install --cask temurin@17
/usr/libexec/java_home -v 17
```
Expected: JDK 17 경로 출력 (예: `/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home`).

- [ ] **Step 2: Android command-line tools + SDK/NDK 설치**

Run:
```bash
brew install --cask android-commandlinetools
# SDK 구성요소 설치 (라이선스 동의 포함)
yes | sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;26.1.10909125"
```
Expected: 각 패키지 `100% ... done`. 에러 없이 종료.

> Homebrew 경로가 다르면 `sdkmanager`가 PATH에 없을 수 있다. 그 경우 `$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager` 절대경로 사용.

- [ ] **Step 3: 환경변수 설정 (zsh 프로파일에 추가)**

`~/.zshrc`에 아래를 추가(이미 있으면 생략):
```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
# Homebrew commandlinetools 사용 시 SDK 루트가 다를 수 있음:
[ -d "$ANDROID_HOME" ] || export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
export NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```
그 후 `source ~/.zshrc`.

- [ ] **Step 4: 환경 검증**

Run:
```bash
echo "JAVA_HOME=$JAVA_HOME"; echo "ANDROID_HOME=$ANDROID_HOME"; echo "NDK_HOME=$NDK_HOME"
java -version 2>&1 | head -1
adb --version | head -1
ls "$NDK_HOME/toolchains" >/dev/null && echo "NDK OK"
```
Expected: 모든 변수 비어있지 않음, `java version "17..."`, `Android Debug Bridge ...`, `NDK OK`.

- [ ] **Step 5: 커밋 (환경변수 파일은 시스템 외부라 커밋 대상 없음 — 스킵)**

이 태스크는 리포 변경이 없으므로 커밋하지 않는다. (사용자 명시 요청 없는 한 커밋 금지 규칙 준수)

---

## Task 2: Rust 안드로이드 타깃 추가

**Files:** 없음(rustup 전역)

- [ ] **Step 1: 안드로이드 타깃 추가**

Run:
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```
Expected: 각 타깃 설치(또는 이미 설치됨) 메시지.

- [ ] **Step 2: 검증**

Run:
```bash
rustup target list --installed | grep android
```
Expected: 4개 android 타깃이 모두 출력.

---

## Task 3: Cargo.toml — 오디오 전용 크레이트를 비-모바일로 게이팅

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml:30-36`

오디오 모듈 전용 크레이트(`cpal`, `hound`, `rubato`)를 안드로이드/iOS 빌드에서 제외한다. (`base64`는 다른 곳에서 쓰일 수 있어 공통 유지. `screencapturekit`은 이미 macOS 한정.)

- [ ] **Step 1: Cargo.toml 의존성 블록 수정**

`Cargo.toml`에서 아래 라인(현재 line 30-36)을:
```toml
base64 = "0.22"
rubato = "0.15"
cpal = { version = "0.15", features = [] }
hound = "3.5"

[target.'cfg(target_os = "macos")'.dependencies]
screencapturekit = "1.5"
```
다음으로 교체:
```toml
base64 = "0.22"

# 네이티브 오디오 캡처는 데스크톱 전용 (모바일은 webview getUserMedia 사용)
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
cpal = { version = "0.15", features = [] }
hound = "3.5"
rubato = "0.15"

[target.'cfg(target_os = "macos")'.dependencies]
screencapturekit = "1.5"
```

- [ ] **Step 2: 데스크톱 빌드 회귀 확인 (cargo check 호스트 타깃)**

Run:
```bash
cd /Users/jji/project/ddobakddobak/frontend/src-tauri && cargo check
```
Expected: 호스트(macOS)에서는 cpal/hound/rubato/screencapturekit가 여전히 포함되어 **에러 없이 통과**. (lib.rs는 Task 4에서 수정하므로 이 시점엔 audio 모듈이 아직 무조건 컴파일되어도 호스트에선 정상.)

- [ ] **Step 3: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src-tauri/Cargo.toml
git commit -m "build(tauri): gate desktop-only audio crates off mobile targets"
```

---

## Task 4: lib.rs — audio 모듈/데스크톱 상태·커맨드를 cfg(desktop)로 분리

**Files:**
- Modify: `frontend/src-tauri/src/lib.rs:1` (mod 선언)
- Modify: `frontend/src-tauri/src/lib.rs:731-788` (`run()` 재구성)

Tauri v2는 `#[cfg(desktop)]` / `#[cfg(mobile)]` rustc cfg를 제공한다. 모바일 빌드에서 `audio` 모듈과 그것을 참조하는 상태/핸들러/윈도우이벤트를 제외한다. 모바일 핸들러는 상태 불필요한 `check_health`만 노출(스파이크용).

- [ ] **Step 1: `mod audio;` 게이팅**

`lib.rs` line 1을:
```rust
mod audio;
```
다음으로 교체:
```rust
#[cfg(desktop)]
mod audio;
```

- [ ] **Step 2: `run()` 함수를 데스크톱/모바일 분기로 재구성**

`lib.rs`의 `run()` 함수 전체(현재 line 731-788)를 아래로 교체:
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // ── 데스크톱 전용: 프로세스 오케스트레이션 + 네이티브 오디오 ──
    #[cfg(desktop)]
    let builder = {
        let project_dir = detect_project_dir();
        let shell_path = resolve_shell_path();
        let tool_paths = discover_tools(&shell_path);

        log::info!("project_dir={}", project_dir.display());
        log::info!(
            "초기 도구 경로: ruby={:?} bundle={:?} uv={:?}",
            tool_paths.ruby, tool_paths.bundle, tool_paths.uv
        );

        builder
            .manage(AppState {
                backend_process: Mutex::new(None),
                sidecar_process: Mutex::new(None),
                project_dir,
                shell_path: Mutex::new(shell_path),
                tool_paths: Mutex::new(tool_paths),
            })
            .manage(audio::AudioCaptureState::default())
            .manage(audio::RecorderState::default())
            .invoke_handler(tauri::generate_handler![
                check_environment,
                install_dependencies,
                check_first_run,
                run_initial_setup,
                start_services,
                stop_services,
                check_health,
                audio::start_system_audio_capture,
                audio::stop_system_audio_capture,
                audio::is_system_audio_capturing,
                audio::start_recording,
                audio::stop_recording,
                audio::pause_recording,
                audio::resume_recording,
                audio::feed_recorder_mic,
            ])
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::Destroyed = event {
                    let state = window.state::<AppState>();
                    kill_child(&state.backend_process);
                    kill_child(&state.sidecar_process);
                }
            })
    };

    // ── 모바일 전용: 서버모드 클라이언트 (로컬 서비스/오디오 없음) ──
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![check_health]);

    builder
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
```

> 주의: 데스크톱 전용 헬퍼/커맨드(`detect_project_dir`, `resolve_shell_path`, `discover_tools`, `check_environment` 등)는 모바일에서 호출되지 않지만 함수 정의 자체는 컴파일된다(std만 사용하므로 android에서도 컴파일됨). 만약 모바일 `cargo check`에서 "never used" 경고가 빌드를 막으면(=`-D warnings`), 해당 항목 위에 `#[cfg_attr(mobile, allow(dead_code))]`를 추가한다. 기본 빌드는 경고를 에러로 취급하지 않으므로 보통 불필요.

- [ ] **Step 3: 데스크톱 회귀 — cargo check (호스트)**

Run:
```bash
cd /Users/jji/project/ddobakddobak/frontend/src-tauri && cargo check
```
Expected: 에러 없이 통과(데스크톱 경로에 audio/AppState 모두 포함).

- [ ] **Step 4: 모바일 크로스컴파일 — cargo check (android)**

Run:
```bash
cd /Users/jji/project/ddobakddobak/frontend/src-tauri && cargo check --target aarch64-linux-android
```
Expected: 에러 없이 통과. (`cpal`/`hound`/`rubato`/`screencapturekit`/`audio` 모듈이 빠지고 컴파일됨.)
실패 시: 누락 cfg 게이팅(audio 참조 잔존) 또는 다른 무조건 데스크톱 의존성을 찾아 동일 패턴으로 게이팅.

- [ ] **Step 5: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src-tauri/src/lib.rs
git commit -m "build(tauri): gate desktop audio/orchestration behind cfg(desktop) for android build"
```

---

## Task 5: Tauri 안드로이드 프로젝트 초기화

**Files:**
- Create: `frontend/src-tauri/gen/android/**` (자동)
- 확인: `frontend/src-tauri/tauri.conf.json`

- [ ] **Step 1: android init**

Run:
```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run tauri android init
```
Expected: `gen/android` 생성, "Project files generated" 류 메시지. 에러 없이 종료.

- [ ] **Step 2: 산출물 검증**

Run:
```bash
ls -d /Users/jji/project/ddobakddobak/frontend/src-tauri/gen/android && \
ls /Users/jji/project/ddobakddobak/frontend/src-tauri/gen/android/app/src/main/AndroidManifest.xml
```
Expected: 디렉토리와 `AndroidManifest.xml` 존재.

- [ ] **Step 3: 마이크 권한 + 평문 http 허용 확인/추가**

`gen/android/app/src/main/AndroidManifest.xml`에 아래가 있는지 확인하고 없으면 `<manifest>` 안에 추가:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```
그리고 `<application ...>` 태그에 평문 LAN(http) 호출 허용을 위해:
```xml
android:usesCleartextTraffic="true"
```
> `usesCleartextTraffic`은 앱→LAN 서버가 평문 http일 때 webview의 fetch/ws가 차단되지 않도록 한다. (스파이크의 핵심 가정과 직접 연결.)

- [ ] **Step 4: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add frontend/src-tauri/gen/android
git commit -m "feat(android): initialize tauri android target with mic + cleartext permissions"
```

---

## Task 6: 실기기 실행 + 연결 스파이크 (핵심 가정 검증)

**Files:**
- Create: `docs/superpowers/notes/2026-05-27-android-spike-results.md`

선행: 서버(이 맥북)에서 Rails가 `0.0.0.0`(또는 LAN 인터페이스)로 떠 있어야 폰이 접근 가능.
- 서버 기동(LAN 바인딩): `cd backend && bin/rails server -b 0.0.0.0 -p 13323` (+ sidecar). 폰과 같은 WiFi 확인.

- [ ] **Step 1: 안드로이드 폰 USB 디버깅 연결**

폰에서 개발자옵션→USB 디버깅 ON, USB 연결 후:
```bash
adb devices
```
Expected: 기기 시리얼이 `device` 상태로 1개 표시. (에뮬레이터로 대체 가능하나, 마이크 검증은 실기기 권장.)

- [ ] **Step 2: 안드로이드 dev 실행**

Run:
```bash
cd /Users/jji/project/ddobakddobak/frontend && npm run tauri android dev
```
Expected: Gradle 빌드 후 폰에 앱 설치·실행. 또박또박 첫 화면(서버 설정/온보딩) 표시.
> 첫 빌드는 NDK 컴파일로 수 분 소요 가능.

- [ ] **Step 3: 서버 URL 입력 + 로그인(서버모드)**

앱에서 서버 URL을 `http://<LAN_IP>:13323` 입력 → 연결 확인(헬스체크 통과) → 로그인.
Expected: `/api/v1/health` 통과, 로그인 성공, 회의 목록 로드(빈 목록이라도 200).
검증 보조 — 폰 로그:
```bash
adb logcat | grep -iE "ddobak|tauri|websocket|getusermedia|denied"
```

- [ ] **Step 4: 마이크 + 실시간 전사 스파이크 (가장 중요)**

앱에서 회의 생성 → 녹음 시작. 폰이 마이크 권한을 묻고, 허용 후 말하면 전사가 흐르는지 확인.
Expected:
- 마이크 권한 프롬프트가 뜬다(= webview가 secure context로 인정, getUserMedia 호출됨).
- 말하면 실시간 전사 텍스트가 화면에 나타난다(= ActionCable `/cable` WS가 평문으로 연결·동작).
- `adb logcat`에 `getUserMedia ... denied`, `mixed content`, `SecurityError`, WS `1006` 없음.

- [ ] **Step 5: 결과 기록**

`docs/superpowers/notes/2026-05-27-android-spike-results.md`에 다음을 기록:
```markdown
# Android 연결 스파이크 결과 (2026-05-27)

- 빌드/실행: 성공/실패 (요약)
- 서버 연결(http LAN): OK/NG
- getUserMedia(마이크): OK/NG  — 권한 프롬프트 여부, secure context 여부
- 실시간 전사(WS /cable, 평문): OK/NG
- 발견된 이슈/로그 발췌:
- 결론: "인증서 없이 마이크+API+WS 동작" 가정 — 입증 / 반증
- 반증 시 대안: 서버 도메인+Let's Encrypt 조기 도입(https)으로 전환
```

- [ ] **Step 6: 커밋**

```bash
cd /Users/jji/project/ddobakddobak
git add docs/superpowers/notes/2026-05-27-android-spike-results.md
git commit -m "docs: record android connectivity spike results"
```

---

## 완료 기준 (Plan 1)

- `cargo check --target aarch64-linux-android` 통과(모바일 크로스컴파일 가능).
- 안드로이드 폰에서 앱 실행 + LAN 서버(http) 접속 + 로그인 성공.
- 폰 마이크로 **녹음→실시간 전사**가 인증서 없이 동작(또는 반증 결과 문서화).
- 데스크톱 빌드 회귀 없음(`cargo check` 호스트 통과).

## Self-Review (스펙 대비)

- 스펙 §4(Tauri 네이티브 인증서 불요 가정) → Task 6 스파이크로 검증 ✓
- 스펙 §10 phase 1(연결 스파이크) → 본 플랜 전체 ✓
- 스펙 §6(데스크톱 네이티브 오디오 유지, 모바일은 webview) → Task 3·4 게이팅 ✓
- 플레이스홀더: 없음(모든 단계 실제 명령/코드 포함). NDK 버전 등 환경값은 명시.
- 타입 일관성: lib.rs 재구성에서 기존 커맨드/상태 명칭 유지, audio:: 경로 일치.
- 미커버(후속 플랜): 반응형 UI(플랜2), 설정잠금/서버선택(플랜3), PWA(플랜4), APK배포(플랜5).
