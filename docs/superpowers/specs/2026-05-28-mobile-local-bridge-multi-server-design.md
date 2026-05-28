# 모바일 다중서버 접속: 앱 내부 로컬 브릿지 + mDNS 디스커버리

날짜: 2026-05-28
상태: 설계 승인 대기

## 문제

안드로이드 폰 앱에서 "서버찾기"가 동작하지 않는다. 근본 원인은 단일 버그가 아니라
배포 구조와 디스커버리 메커니즘의 불일치다:

1. LAN HTTPS 진입점이던 Caddy가 옛 IP(`10.110.14.219`)·인증서에 고정 → 네트워크 변경
   (현재 `192.168.31.37`) 후 바인딩 불가로 미가동.
2. rails(13323)·vite(13325)가 loopback 전용 → LAN 미도달.
3. `scan_lan_servers`는 HTTP:13323을 훑지만 실제 진입점은 HTTPS:13443 → 설계 불일치.
4. TLS 인증서가 접속 주소(IP)에 묶여 네트워크 이동마다 재발급·재기동 필요.

요구사항:
- **다중 서버**를 두고 폰에서 **필요한 서버를 골라** 회의 진행.
- 네트워크가 바뀌어도 **맥(서버)은 아무 작업도 하지 않는다**(재기동 포함 최소화).
- 폰은 **보통 앱처럼** 동작 — CA 설치 등 비정상 셋업 없음.

## 핵심 통찰

마이크는 폰 앱 WebView(`https://tauri.localhost`, secure origin)의 `getUserMedia`로
캡처되므로 **항상 동작**한다. CA/TLS에 묶인 유일한 이유는 *WebView의 fetch/WebSocket이
원격 서버로 직접 나가* 서버 TLS를 신뢰해야 하기 때문이다.

→ 서버 통신을 **폰 앱 내부 Rust 층(로컬 브릿지)을 경유**시키면 서버 TLS가 불필요해지고
CA·인증서·도메인 문제가 통째로 사라진다.

## 설계 (옵션 1: 앱 내부 로컬 브릿지)

### 구조
```
[안드로이드 앱]                                  [맥 서버]
 WebView = https://tauri.localhost (secure)
   · mic = getUserMedia (secure origin, OK)
   · API  = http://127.0.0.1:<P>/api/v1/* ─┐
   · WS   = ws://127.0.0.1:<P>/cable ───────┤  (127.0.0.1=신뢰 출처라 mixed-content 아님)
                                            │
 [Rust 로컬 브릿지 :127.0.0.1:<P>] ─────────┘
   · HTTP 리버스 프록시 + WS 업그레이드 프록시
   · target = 선택된 서버 (http://<ip>:13323) ──평문 HTTP/WS──→ rails 0.0.0.0:13323
 [mDNS 브라우즈] ←──────── _ddobak._tcp 광고 ──────────────── [mDNS 광고]
```

### 컴포넌트
- **Rust 로컬 브릿지** (`src-tauri`, mobile 타깃):
  - 시작 시 `127.0.0.1`의 임의 포트에 HTTP+WS 리버스 프록시 기동(tokio/hyper + tokio-tungstenite).
  - `set_bridge_target(url)` 커맨드로 포워딩 대상(선택 서버) 설정/변경.
  - `bridge_port()` 커맨드로 프론트에 포트 노출.
  - 요청/WS를 대상 서버로 그대로 포워딩(헤더·바디·업그레이드 포함).
- **mDNS** (`src-tauri`):
  - desktop: `_ddobak._tcp.local` 광고(인스턴스명 = 서버 설정명·기본 hostname, 포트 13323).
  - mobile: 브라우즈 → `{name, host, addresses, port}` 목록 반환하는 커맨드.
  - cfg 게이팅(desktop=광고, mobile=브라우즈).
- **프론트**:
  - `config.ts`: 모바일+Tauri일 때 `getApiBaseUrl()`/`ws_url`을 로컬 브릿지(`http://127.0.0.1:<P>`)로.
  - `ServerSetup`: 스캔 결과를 mDNS 브라우즈 결과로 교체(기존 목록/선택/저장 UI 재사용).
    서버 선택 시 `set_bridge_target` 호출 + 기존 per-server 토큰 키(`getServerKey`) 유지.
  - 수동 URL 입력 폴백 유지(mDNS 차단 망 대비).
- **서버**: rails `0.0.0.0:13323` 평문 HTTP. Caddy·인증서·CA 제거.

### 인증 연동
- 브릿지는 **폰에서 실행** → 서버로의 연결 출발지 IP = 폰의 LAN IP(비-loopback).
  → rails `request.remote_ip` 비-loopback → `local_request?`=false → **JWT 필요**(폰 정상 로그인).
- 맥 데스크톱 앱 자신은 rails `127.0.0.1` 직결 → loopback=admin 유지.
- 하이브리드 인증 모델 불변. XFF 조작 불필요(서버 앞단 프록시 없음).

### 네트워크 이동 시
- 서버: rails가 `0.0.0.0` 바인딩이라 새 IP 자동 추종 → **무작업**.
- 폰: mDNS 재브라우즈로 새 IP 획득 → `set_bridge_target` 갱신. 저장 서버는 mDNS로 재해석.

### dev.sh 변경
- `RAILS_CMD`에 `-b 0.0.0.0` 추가.
- `SERVER_MODE=true` 환경 추가(원격 JWT 인증 동작에 필요, 현재 누락).
- Caddy 단계 불필요(존재 시 제거).
- dev 환경 폰 디스커버리 테스트용 mDNS 광고 보조(예: `dns-sd -R` 또는 데스크톱 앱 광고로 대체).

## 트레이드오프 / 수용 사항
- **LAN 구간 평문**: 음성·회의 데이터가 동일 WiFi에서 평문 전송(도청 가능). 사설 LAN·개인용
  전제로 수용. 추후 필요 시 옵션 2(공인 도메인+와일드카드 인증서)로 격상 가능.
- 폰 앱에 HTTP+WS 리버스 프록시 신규 구현 필요.

## 검증 스파이크 (구현 최우선)
- Android WebView(`https://tauri.localhost`)에서 `http://127.0.0.1:<P>` fetch + `ws://127.0.0.1:<P>`
  WS가 mixed-content 차단 없이 동작하는지 **먼저 확인**. 차단 시 설계 재검토.

## 컴포넌트 경계 (단위)
- `bridge`: 로컬 HTTP+WS 프록시. 입력=대상 URL·요청, 출력=서버 응답. 독립 테스트 가능.
- `mdns`: 광고/브라우즈. 입력=서비스 메타, 출력=발견 목록.
- 프론트 `serverConnection`: 선택 서버 → 브릿지 타깃 설정 + base URL 계산.

## 테스트
- Rust 단위: 브릿지 HTTP 포워딩, WS 업그레이드 포워딩, 타깃 전환.
- 백엔드 스펙: 원격 IP→JWT 강제 / loopback→admin (기존 server_mode 스펙 확장).
- 수동: 맥 A·B 2대 광고 → 폰 목록 2개 → 각각 접속·로그인·녹음·mic·실시간 전사 확인,
  네트워크 변경 후 재발견.

## 비고
- 기존 spec `2026-05-28-per-server-persistent-login-design.md`(서버별 토큰)와 정합.
  `getServerKey()`는 저장 서버 URL 기준 유지(브릿지 도입과 무관).
- 데스크톱 앱(로컬 모드)은 변경 없음. 디스커버리는 모바일 주용도.
