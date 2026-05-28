# 플랫폼 고정 모드 (웹=서버 / 데스크톱 앱=로컬) 설계

날짜: 2026-05-28

## 배경 / 문제

또박또박은 하이브리드 인증 모델을 쓴다 — 맥 본체(loopback)는 로컬 admin, 원격 기기는 JWT 로그인. 클라이언트의 동작 모드는 `getMode()`로 결정된다.

현재 `getMode()`:
```ts
if (IS_MOBILE) return 'server'
const mode = localStorage.getItem('mode')
return mode === 'server' ? 'server' : 'local'
```

문제: **데스크톱 웹 브라우저**가 `localStorage` 미설정 시 `local`로 기본 동작한다. 그러나 웹은 Caddy(예: `https://<ip>:13443`) 경유로 접속하며, Caddy가 `X-Forwarded-For`에 실제 클라이언트 IP를 실어 보내므로 Rails는 이를 **원격**으로 본다(`local_request?`가 `request.remote_ip` 사용). 결과적으로 서버 모드 백엔드가 JWT를 요구하는데 프론트는 local 모드(로그인 없음)라 모든 API가 **401**을 받는다.

즉 "웹인데 local 모드" 조합이 깨진 상태다. 모드를 플랫폼으로 결정적으로 고정해 이 혼선을 제거한다.

## 목표

- **웹 브라우저** → 항상 **server** 모드.
- **맥 데스크톱 앱(Tauri desktop)** → 항상 **local** 모드.
- **모바일**(웹/PWA, Tauri Android) → 항상 **server** 모드 (현행 유지).
- `localStorage` 기반 모드 선택/재설정 UI 제거(플랫폼이 모드를 결정).

## 설계

### 1. `getMode()` — 플랫폼 결정적

`frontend/src/config.ts`
```ts
export function getMode(): 'local' | 'server' {
  if (IS_TAURI && !IS_MOBILE) return 'local'  // 맥 데스크톱 앱만 로컬
  return 'server'                              // 웹 + 모든 모바일
}
```
- `localStorage['mode']` 의존 제거.
- `hasMode()` / `clearMode()` — 호출처 정리 후 미사용이면 제거. `localStorage['mode']` 쓰기 코드 전부 제거.

### 2. server 모드 API/WS base — 클라이언트별 분기

`getApiBaseUrl()` / `getWsUrl()` (server 분기):
- **웹**(`!IS_TAURI`): 동일 origin 사용.
  - API: `${window.location.origin}/api/v1`
  - WS: `window.location.origin`의 `http→ws`, `https→wss` 치환 + `/cable`
  - → Caddy가 프론트와 API를 같은 origin으로 묶으므로 IP 입력·CORS 불필요. `.env.local`의 `VITE_API_BASE_URL` 불필요.
- **모바일 앱**(`IS_TAURI && IS_MOBILE`, = Tauri Android): 기존 `getServerUrl()` 유지(사용자가 서버 주소 입력).

local 분기(맥 데스크톱 앱)는 현행 유지: `http://127.0.0.1:13323`.

### 3. SetupGate

`frontend/src/components/SetupGate.tsx` `initialGate()`:
- **웹**(`!IS_TAURI`): 현행처럼 `'ready'` → AuthGuard가 server 모드 미인증 시 로그인 표시. (변경 없음)
- **Tauri 데스크톱**(local 고정): 모드 선택(`mode_select`) 제거. dev → `'ready'`, prod → `'local_setup'`.
- **Tauri 모바일**(server 고정): 서버 주소 입력 필요. `server_url` 없으면 주소 입력 화면, 있으면 `'ready'`.

### 4. ServerSetup / 모드 선택 UI

- `ServerSetup`은 **모바일 앱의 서버 주소 입력 전용**으로 축소(local/server 모드 선택 토글 제거 — 모드는 플랫폼 고정).
- `SettingsContent`의 "모드 재설정" 버튼·"실행 모드" 토글 UI 제거. `sessionStorage['reselect_mode']` 흐름 제거. (현재 동작 모드는 읽기 전용 텍스트로만 표기.)

### 5. 정리(cleanup)

- `.env.local`의 `VITE_API_BASE_URL` / `VITE_WS_URL` — 웹 라우팅에서 더는 안 쓰임. 파일은 남기되 상단 주석에 "현재 미사용(웹은 동일 origin 사용)" 표기.
- 미사용이 된 `hasMode`, `clearMode`, `localStorage['mode']` 관련 코드 제거.

## 영향 파일

- `frontend/src/config.ts` — `getMode`, `getApiBaseUrl`, `getWsUrl`, (`hasMode`/`clearMode` 정리)
- `frontend/src/components/SetupGate.tsx` — `initialGate` 분기 재구성
- `frontend/src/components/auth/ServerSetup.tsx` — 모바일 URL 입력 전용으로 축소
- `frontend/src/components/settings/SettingsContent.tsx` — 모드 재설정 UI 제거
- 테스트: `ServerSetup.test.tsx`, config/SetupGate 관련 스펙 갱신

## 엣지 케이스

- **맥 본인 브라우저로 로컬 백엔드 테스트**: 웹=server 고정이므로 더는 로그인 없이 못 봄. 필요 시 로그인(JWT)으로 접근 — 의도된 동작.
- **웹 동일 origin 도출**: `window.location.origin`이 곧 Caddy origin. 접속 IP/호스트가 바뀌어도 자동 추종(스테일 IP 문제 해소).
- **Tauri Android**: `IS_MOBILE` true라 `IS_TAURI && !IS_MOBILE` 거짓 → server. 기존 서버주소 입력 흐름 유지.
- **mkcert 인증서 신뢰**(웹/폰 HTTPS) 및 **사용자 계정 생성**은 본 변경 범위 밖(운영 절차).

## 테스트

- 단위: `getMode()`가 (IS_TAURI, IS_MOBILE) 조합별로 기대 모드 반환.
- 단위: `getApiBaseUrl`/`getWsUrl` 웹 server 분기가 `window.location.origin` 기반 값 반환.
- 컴포넌트: SetupGate가 플랫폼별로 올바른 게이트 진입(웹 ready, 데스크톱 local, 모바일 URL 입력).
- 기존 `ServerSetup` 스펙 갱신.

## 범위 밖 (out of scope)

- 백엔드 인증/`local_request?` 로직 변경 없음(현행 정상).
- mkcert CA 설치, Caddy 운영, 사용자 계정 생성 등 운영 절차.
- 사용자 관리 탭 게이팅 수정(이미 별도 반영: `isAdmin || getMode()==='local'`).
