# 모바일 다중서버 로컬 브릿지 + mDNS 디스커버리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안드로이드 앱이 mDNS로 LAN의 또박또박 서버들을 발견·선택하고, 앱 내부 로컬 브릿지를 통해 평문 HTTP/WS로 접속하게 하여 TLS/CA/도메인 없이 다중서버 접속을 구현한다.

**Architecture:** 폰 앱 WebView(`https://tauri.localhost`)는 마이크(secure origin)를 유지하고, 서버 통신은 폰 앱 내부 Rust 로컬 브릿지(`127.0.0.1:<P>`)를 경유한다. 브릿지가 선택된 서버(`http://<ip>:13323`)로 평문 포워딩하므로 서버 TLS가 불필요. 서버는 rails `0.0.0.0:13323` 평문. 발견은 mDNS(`_ddobak._tcp`).

**Tech Stack:** Rust(tokio, hyper, tokio-tungstenite, mdns-sd), Tauri v2(mobile), React/TS(config.ts, ServerSetup.tsx), Rails.

---

## File Structure

- `frontend/src-tauri/Cargo.toml` — deps 추가(tokio, hyper, http-body-util, hyper-util, tokio-tungstenite, mdns-sd).
- `frontend/src-tauri/src/bridge.rs` — (신규) 모바일 로컬 HTTP+WS 리버스 프록시 + 타깃 상태.
- `frontend/src-tauri/src/mdns.rs` — (신규) desktop 광고 / mobile 브라우즈.
- `frontend/src-tauri/src/lib.rs` — 모듈 선언 + invoke_handler 등록(cfg 게이팅), 데스크톱 mDNS 광고 기동.
- `frontend/src/config.ts` — 모바일+Tauri일 때 base/ws를 로컬 브릿지로.
- `frontend/src/lib/bridge.ts` — (신규) 브릿지 포트 조회/타깃 설정 래퍼.
- `frontend/src/components/auth/ServerSetup.tsx` — 스캔 → mDNS 브라우즈, 선택 시 타깃 설정.
- `dev.sh` — rails `-b 0.0.0.0` + `SERVER_MODE=true`.
- `app-server.sh` — rails `-b 0.0.0.0` + `SERVER_MODE=true`(sidecar는 loopback 유지).

---

## Task 0: 검증 스파이크 — WebView 루프백 호출 (게이트)

설계 전제: `https://tauri.localhost`에서 `http://127.0.0.1:<P>` fetch + `ws://127.0.0.1:<P>` WS가 mixed-content 차단 없이 동작. 실패 시 이후 전 과업 무효 → 먼저 확인.

**Files:**
- 임시 Modify: `frontend/src-tauri/src/lib.rs` (임시 echo 커맨드/스레드), `frontend/src/main.tsx` 또는 임시 버튼.

- [ ] **Step 1: 임시 루프백 서버 + 커맨드 추가**

`lib.rs`에 모바일에서 임시로 `127.0.0.1:0`(임의포트) 바인딩해 `/ping`→`pong`, `/ws` echo를 응답하는 스레드 + 포트 반환 커맨드 `__spike_port()` 추가. (std::net + 수동 HTTP/WS 핸드셰이크 or tokio. 간단히 std TcpListener로 HTTP `/ping`만, WS는 tokio-tungstenite 임시.)

- [ ] **Step 2: 프론트 임시 테스트 호출**

앱 부팅 시 `invoke('__spike_port')`로 포트 얻어 `fetch('http://127.0.0.1:'+p+'/ping')` 및 `new WebSocket('ws://127.0.0.1:'+p+'/ws')` 결과를 `console.log`/화면에 표시.

- [ ] **Step 3: 디바이스에서 확인**

Run: `cd frontend && npm run tauri android build -- --apk --target aarch64` 후 설치, `adb logcat | grep -i chromium` 또는 앱 화면에서 fetch=pong, ws=open 확인.
Expected: fetch 200 "pong", WS onopen 발생, mixed-content 에러 없음.

- [ ] **Step 4: 결과 판정 + 임시 코드 제거**

통과 → 임시 코드 되돌리고 Task 1 진행. 실패(차단) → 중단하고 설계 재검토(옵션 2 도메인 방식). 임시 변경 revert.

- [ ] **Step 5: Commit (통과 시, revert 상태)**

```bash
git add -A && git commit -m "chore: verify webview loopback reachability (spike, reverted)"
```

---

## Task 1: 서버 LAN 바인딩 + dev.sh + app-server.sh

**Files:**
- Modify: `dev.sh` (RAILS_CMD)
- Modify: `app-server.sh` (rails bind 0.0.0.0 + SERVER_MODE; sidecar는 loopback 유지)
- Modify: `frontend/src-tauri/src/lib.rs:654` (데스크톱 오케스트레이션 bind — 데스크톱 앱 자신은 loopback 직결=admin이 맞음. 단 폰이 데스크톱 앱이 띄운 서버에 붙으려면 LAN 바인딩 필요 → `-b 0.0.0.0`으로 변경. 하이브리드 인증은 remote_ip 기준이라 admin 노출 없음)
- Test: `backend/spec/requests/api/v1/...` (원격→JWT 경계, 기존 server_mode 스펙 확장)

- [ ] **Step 1: dev.sh 수정**

`dev.sh`의 `RAILS_CMD`를:
```bash
RAILS_CMD="SERVER_MODE=true bin/rails server -p ${RAILS_PORT} -b 0.0.0.0"
```
(기존: `RAILS_CMD="bin/rails server -p ${RAILS_PORT}"`)

- [ ] **Step 1b: app-server.sh 수정**

rails는 LAN 바인딩 + SERVER_MODE, sidecar는 내부 전용이라 loopback 유지하도록 분리:
```bash
# 기존: HOST_BIND="${HOST_BIND:-127.0.0.1}"  (rails·sidecar 공용)
RAILS_BIND="${RAILS_BIND:-0.0.0.0}"        # 폰/LAN 접속 허용
SIDECAR_BIND="${SIDECAR_BIND:-127.0.0.1}"  # rails만 호출, 외부 노출 불필요
```
`rails_cmd`에 `SERVER_MODE=true` 추가 + `-b $RAILS_BIND`:
```bash
rails_cmd="SERVER_MODE=true RAILS_ENV=production DB_PATH=\"$DB_PATH\" AUDIO_DIR=\"$AUDIO_DIR\" RAILS_LOG_TO_STDOUT=1 SOLID_QUEUE_IN_PUMA=1 bin/rails server -p $RAILS_PORT -b $RAILS_BIND"
sidecar_cmd="MODELS_DIR=\"$MODELS_DIR\" SPEAKER_DBS_DIR=\"$SPEAKER_DBS_DIR\" uv run uvicorn app.main:app --host $SIDECAR_BIND --port $SIDECAR_PORT"
```
로그 출력 줄의 `$HOST_BIND`도 각각 `$RAILS_BIND`/`$SIDECAR_BIND`로 갱신. 포트 점유 체크(`nc -z 127.0.0.1`)는 그대로 유효(0.0.0.0 바인딩도 127.0.0.1로 응답).

- [ ] **Step 1c: lib.rs 데스크톱 bind 변경**

`frontend/src-tauri/src/lib.rs:654`의 `"-b", "127.0.0.1"` → `"-b", "0.0.0.0"`. (데스크톱 앱이 띄운 서버에 폰이 붙을 수 있게. 앱 자신은 여전히 127.0.0.1로 호출 → loopback admin 유지.)

- [ ] **Step 2: LAN 도달 확인 (수동)**

dev.sh로 기동 후:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://$(ipconfig getifaddr en0):13323/api/v1/health`
Expected: `200`

- [ ] **Step 3: 인증 경계 스펙 작성/확장**

`backend/spec/requests/`에서 SERVER_MODE + 비-loopback `REMOTE_ADDR`(예 `192.168.0.50`)로 보호 엔드포인트 요청 → 401(JWT 필요), loopback `127.0.0.1` → admin 동작. 기존 server_mode 스펙 있으면 거기에 추가.

```ruby
# 비-loopback은 로컬 admin으로 취급되지 않아야 한다
it "remote IP는 JWT 없이 거부" do
  get "/api/v1/meetings", env: { "REMOTE_ADDR" => "192.168.0.50" }
  expect(response).to have_http_status(:unauthorized)
end
```

- [ ] **Step 4: 스펙 실행**

Run: `cd backend && SERVER_MODE=true bundle exec rspec spec/requests/api/v1/...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dev.sh app-server.sh frontend/src-tauri/src/lib.rs backend/spec
git commit -m "feat: serve rails on LAN (0.0.0.0) + SERVER_MODE in dev/app-server; assert remote→JWT"
```

---

## Task 2: Rust 로컬 브릿지 (모바일 HTTP+WS 리버스 프록시)

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`
- Create: `frontend/src-tauri/src/bridge.rs`
- Modify: `frontend/src-tauri/src/lib.rs` (mod 선언, mobile invoke_handler, 부팅 시 브릿지 기동)

- [ ] **Step 1: Cargo deps 추가 (mobile 타깃)**

`Cargo.toml`에:
```toml
[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "net", "io-util", "macros", "sync"] }
hyper = { version = "1", features = ["client", "server", "http1"] }
hyper-util = { version = "0.1", features = ["tokio"] }
http-body-util = "0.1"
tokio-tungstenite = "0.24"
```

- [ ] **Step 2: 브릿지 상태/타깃 + 기동 함수 작성**

`bridge.rs`:
```rust
use std::sync::{Arc, Mutex};
use tokio::sync::OnceCell;

#[derive(Default)]
pub struct BridgeState {
    pub target: Arc<Mutex<Option<String>>>, // http://<ip>:13323
    pub port: Arc<Mutex<Option<u16>>>,
}

// 127.0.0.1:0 바인딩 → 포트 저장, 요청을 target으로 포워딩(HTTP + WS upgrade).
// hyper 서비스: Upgrade 헤더 있으면 tokio-tungstenite로 양방향 파이프, 아니면 일반 프록시.
pub async fn serve(state: Arc<BridgeState>) { /* 상세 구현 */ }
```
(HTTP: 들어온 경로/메서드/헤더/바디를 `target + path`로 재요청. WS: `Connection: Upgrade`면 클라이언트와 서버 양쪽 업그레이드 후 tokio::io::copy_bidirectional.)

- [ ] **Step 3: 커맨드 추가**

`bridge.rs`:
```rust
#[tauri::command]
pub fn bridge_port(state: tauri::State<Arc<BridgeState>>) -> Option<u16> {
    *state.port.lock().unwrap()
}
#[tauri::command]
pub fn set_bridge_target(url: String, state: tauri::State<Arc<BridgeState>>) {
    *state.target.lock().unwrap() = Some(url.trim_end_matches('/').to_string());
}
```

- [ ] **Step 4: lib.rs 등록 + 부팅 기동 (mobile)**

`#[cfg(mobile)]` 블록에서 `BridgeState` manage, setup에서 tokio 런타임 스폰해 `bridge::serve` 실행, `invoke_handler`에 `check_health, bridge_port, set_bridge_target, mdns_browse` 등록.

- [ ] **Step 5: Rust 단위 테스트 (포워딩)**

`bridge.rs` `#[cfg(test)]`: 로컬 mock 서버(임의 포트) 띄우고 set_target 후 브릿지로 `/api/v1/health` 요청 → mock 응답 그대로 받는지. WS는 echo mock으로 업그레이드 후 메시지 왕복 확인.

- [ ] **Step 6: 테스트 실행**

Run: `cd frontend/src-tauri && cargo test --target aarch64-linux-android bridge` (또는 host 타깃에서 테스트 가능하도록 cfg 완화 후 `cargo test bridge`)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/bridge.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(mobile): in-app loopback HTTP/WS reverse proxy bridge"
```

---

## Task 3: mDNS 광고(데스크톱) + 브라우즈(모바일)

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (mdns-sd 공통 deps)
- Create: `frontend/src-tauri/src/mdns.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

- [ ] **Step 1: dep 추가**

`Cargo.toml [dependencies]`에 `mdns-sd = "0.11"`.

- [ ] **Step 2: 광고 (desktop)**

`mdns.rs`:
```rust
#[cfg(desktop)]
pub fn advertise(instance: &str, port: u16) -> mdns_sd::Result<mdns_sd::ServiceDaemon> {
    use mdns_sd::{ServiceDaemon, ServiceInfo};
    let daemon = ServiceDaemon::new()?;
    let host = hostname::get().unwrap_or_default().to_string_lossy().to_string();
    let info = ServiceInfo::new("_ddobak._tcp.local.", instance, &format!("{host}.local."),
        (), port, None)?.enable_addr_auto();
    daemon.register(info)?;
    Ok(daemon)
}
```
(instance = 서버 설정명·기본 hostname. port = 13323.)

- [ ] **Step 3: 브라우즈 (mobile) 커맨드**

`mdns.rs`:
```rust
#[derive(serde::Serialize)]
pub struct Found { pub name: String, pub url: String }

#[tauri::command]
pub async fn mdns_browse() -> Vec<Found> {
    // ServiceDaemon::browse("_ddobak._tcp.local.") 2~3초 수집 →
    // 각 ResolvedService의 첫 IPv4 + port로 http://ip:port 구성, name=instance.
}
```

- [ ] **Step 4: lib.rs 연결**

desktop setup에서 `mdns::advertise(...)` 호출(데몬 핸들 보관). mobile invoke_handler에 `mdns_browse` 등록.

- [ ] **Step 5: 단위/수동 테스트**

Rust 단위: 광고 등록이 에러 없이 데몬 반환. 수동: 맥 dev 기동 후 다른 기기/`dns-sd -B _ddobak._tcp`로 광고 노출 확인.

Run: `dns-sd -B _ddobak._tcp local.`
Expected: 또박또박 인스턴스 표시.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/mdns.rs frontend/src-tauri/src/lib.rs
git commit -m "feat: mDNS advertise (desktop) + browse (mobile)"
```

---

## Task 4: 프론트 — 브릿지 base URL + mDNS 디스커버리

**Files:**
- Create: `frontend/src/lib/bridge.ts`
- Modify: `frontend/src/config.ts` (getApiBaseUrl/getWsUrl 모바일 분기)
- Modify: `frontend/src/components/auth/ServerSetup.tsx`
- Test: `frontend/src/components/auth/__tests__/ServerSetup.test.tsx`

- [ ] **Step 1: bridge.ts 래퍼**

```ts
import { invoke } from '@tauri-apps/api/core'
let cachedPort: number | null = null
export async function ensureBridgePort(): Promise<number | null> {
  if (cachedPort) return cachedPort
  cachedPort = (await invoke<number | null>('bridge_port')) ?? null
  return cachedPort
}
export function setBridgeTarget(url: string) {
  return invoke('set_bridge_target', { url })
}
export async function mdnsBrowse(): Promise<{ name: string; url: string }[]> {
  return invoke('mdns_browse')
}
```

- [ ] **Step 2: config.ts 모바일 분기**

`getApiBaseUrl()`/`getWsUrl()` 모바일+Tauri 경로에서 서버 URL 대신 브릿지 포트 사용. 브릿지 포트는 동기 함수에서 못 얻으니 부팅 시 `ensureBridgePort()` 후 모듈 변수에 캐시하고, 두 함수는 캐시된 포트로 `http://127.0.0.1:<P>/api/v1` / `ws://127.0.0.1:<P>/cable` 반환. 타깃은 `set_bridge_target`이 별도 보관.

- [ ] **Step 3: ServerSetup 스캔→mDNS**

`handleScan`을 `mdnsBrowse()` 호출로 교체. 결과 `{name,url}[]`를 기존 `foundServers` 자리(이름 표시 포함)로 렌더. `pickServer(url)`에서 `setBridgeTarget(url)` 호출 후 health 확인.

- [ ] **Step 4: 테스트 갱신**

`ServerSetup.test.tsx`에서 `invoke('mdns_browse')` mock → 목록 렌더·선택 시 `set_bridge_target` 호출 검증.

Run: `cd frontend && npx vitest run src/components/auth/__tests__/ServerSetup.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/bridge.ts frontend/src/config.ts frontend/src/components/auth/ServerSetup.tsx frontend/src/components/auth/__tests__/ServerSetup.test.tsx
git commit -m "feat(mobile): mDNS discovery + route API/WS via local bridge"
```

---

## Task 5: 통합 빌드 + 다중서버 수동 검증

- [ ] **Step 1: 빌드**

Run: `cd frontend && npm run tauri android build -- --apk --target aarch64`
Expected: APK 생성.

- [ ] **Step 2: 데스크톱 빌드(광고 포함)**

Run: `cd frontend && npm run tauri build`
Expected: .app 빌드(앞서 DMG는 hdiutil 대체).

- [ ] **Step 3: 다중서버 수동 시나리오**

맥 A·B 두 서버(dev.sh 기동, 각각 인스턴스명 다르게) → 폰 APK 설치 → "서버찾기" → 목록에 A·B 표시 → A 선택·로그인·녹음·실시간 전사 확인 → B로 전환 재확인.

- [ ] **Step 4: 네트워크 이동 검증**

Wi-Fi 변경(서버 IP 변동) → 맥 무작업 → 폰 재브라우즈 시 새 IP로 재발견·접속.

- [ ] **Step 5: Commit (필요 시 마무리)**

```bash
git add -A && git commit -m "test: multi-server discovery + network-change manual verification notes"
```

---

## Self-Review

- 스펙 커버리지: 다중서버 발견/선택(Task3,4), 맥 무작업(Task1 0.0.0.0 + Task3 광고), CA없음(Task2 브릿지), 인증 보존(Task1), dev.sh(Task1) — 전부 매핑됨.
- 스파이크 게이트(Task0)로 전제 검증 선행.
- 잔여 리스크: WS 업그레이드 프록시 구현 난이도(Task2 Step2), 모바일 Rust 테스트 타깃(host에서 cfg 완화 권장).
