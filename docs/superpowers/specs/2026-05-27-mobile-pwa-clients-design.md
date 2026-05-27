# 또박또박 — 셀프호스트 서버 + 멀티 클라이언트(Tauri 네이티브 + PWA) 설계

- 작성일: 2026-05-27
- 상태: 설계(브레인스토밍 산출물) — 구현 계획 전 단계

## 1. 배경 / 문제

또박또박은 Tauri v2 **데스크톱 우선**으로 만들어졌고, 백엔드(Rails + Sidecar STT/LLM)는 한 컴퓨터에서 돌아간다. 사용자는 **자기 컴퓨터를 서버로 두고, 폰·태블릿·PC에서 클라이언트로 접속**해서 쓰고 싶어 한다.

LAN 웹 접속을 시도하다 **모바일 브라우저 마이크 = HTTPS 필수** 제약에 부딪혔고(Caddy+mkcert로 우회했으나 기기마다 인증서 설치가 번거로움, `ERR_CERT_AUTHORITY_INVALID`), UI도 전반적으로 모바일에 맞지 않는 상태다.

## 2. 목표 / 비목표

**목표**
- 한 컴퓨터 = 서버. 폰/태블릿/PC가 클라이언트로 접속.
- 가족/팀 몇 명이 각자 기기에서 사용(서버모드 + JWT 로그인).
- 모바일에서 **녹음·실시간 전사·회의 CRUD·회의록 편집**이 자연스럽게 동작.
- **클라이언트에서 서버 IP/URL을 지정·전환** (서버용 맥북이 여러 대라 골라서 접속).
- 인증서/HTTPS 마찰 최소화.
- 단일 React 코드베이스 유지.

**비목표(현재)**
- iOS 네이티브 앱(유료 $99/년) — PWA로 대체, 필요 시 후속.
- 모바일에서 서버/앱 설정 변경 — 의도적으로 잠금.
- 외부망 접속 — 구조만 열어두고 후속(도메인+Let's Encrypt).
- 클라이언트에서 STT/LLM 로컬 실행 — 전부 서버가 처리.

## 3. 아키텍처

```
┌──────────────────────────────────────────────┐
│  내 컴퓨터 = 서버                               │
│   Rails(13323) + Sidecar(13324, STT/LLM)       │
│   DB / Solid Queue / ActionCable(/cable)        │
└───────────────┬────────────────────────────────┘
        LAN(지금: http://<IP>:13323)
        외부(나중: https://<도메인>, Caddy+Let's Encrypt)
   ┌────────────┼───────────────┬─────────────────┐
[PC 클라이언트]  [안드로이드 폰]    [iOS/아무 기기]
 Tauri 데스크톱   Tauri 네이티브     PWA(무설치/무료)
   (기존)        (1순위, 신규)      (폴백 타깃)
        └ 전부 "서버모드" + JWT 로그인 (가족/팀 멀티유저) ┘
```

- **단일 코드베이스**: 지금의 React 프론트엔드를 (a) Tauri 데스크톱, (b) Tauri 안드로이드, (c) PWA(서버가 정적 서빙)로 빌드. 플랫폼 분기만 추가.
- **모든 클라이언트 = 서버모드**: 기존 `ServerSetup`(서버 URL) + `LoginPage`(JWT) 재사용.

## 4. 클라이언트 타깃과 인증서/HTTPS 전략

| 타깃 | 방식 | 비용 | 마이크 | 인증서(LAN) |
|---|---|---|---|---|
| 안드로이드 폰 (1순위) | Tauri 네이티브 | 0원 | webview `getUserMedia` (앱 출처가 secure context) | **불필요** |
| PC | Tauri 데스크톱(기존) | 0원 | 네이티브/웹뷰 | 불필요 |
| iOS / 아무 기기 | **PWA**(홈화면 추가) | **0원** | Safari `getUserMedia` (**HTTPS 필요**) | LAN=mkcert 설치 필요 / **외부=도메인이면 불필요** |

**Tauri 네이티브가 인증서 문제를 없애는 이유**: 안드로이드 Tauri 앱은 UI를 신뢰된 내부 스킴(`http://tauri.localhost`)에서 로드하고 웹뷰가 이를 **secure context로 취급** → `getUserMedia`가 인증서 없이 동작. API/WS는 평문 `http://<서버IP>:13323` 직접 호출(앱 출처가 https가 아니라 mixed-content 차단 없음).
> ⚠️ 이 가정은 **구현 1단계 스파이크로 반드시 검증**(아래 6단계).

**PWA의 HTTPS 조건**: PWA는 WebKit/브라우저라 마이크에 HTTPS가 필요. LAN에서는 기기에 mkcert CA 설치, **외부 도메인+Let's Encrypt 도입 시 조건 소멸**(공인 인증서라 무설치·무료). iOS 홈화면 PWA 마이크는 iOS 버전별로 불안정 이력 → 실기기 검증 필요.

## 5. 권한 모델 (모바일 제한 = 설정만 잠금)

`IS_MOBILE` 플랫폼 감지 플래그로 UI/라우트 분기.

**모바일에서 허용**: 녹음·실시간 전사, 회의 조회/검색, **회의 삭제·이름변경**, **회의록(AI 노트) 편집**, 북마크/화자 라벨 등 회의 콘텐츠 전반.

**모바일에서 잠금(숨김+라우트 가드)**: 앱/서버 **설정 전체** — STT 엔진, LLM, 화자분리 파라미터, 사용자 관리, 서버 설정. (설정 변경은 PC/서버에서만)
- 구현: 모바일에서 설정 진입점 비노출 + `/settings` 라우트 가드. (가능하면 서버측에서도 모바일 토큰의 설정변경 API 거부로 이중 방어.)
- 부수효과: `SettingsModal` 모바일 반응형 작업은 불필요(데스크톱에서만 노출).

## 6. 오디오 캡처

- 모바일/PWA: 기존 `useAudioRecorder`의 **브라우저 경로**(getUserMedia + AudioWorklet → PCM을 ActionCable `/cable`로 전송) 재사용.
- 데스크톱 전용 네이티브 캡처(`cpal`, `screencapturekit`=macOS 전용)는 데스크톱 분기 뒤에 유지. 시스템오디오 캡처는 데스크톱 기능.
- 모바일은 **마이크 녹음** 중심. (모바일용 네이티브 오디오 플러그인은 복잡도 대비 이득 적어 비채택.)

## 7. 모바일 UI (폰 우선 반응형)

같은 React UI가 모바일 웹뷰/브라우저에 렌더되므로 반응형 정비가 전제. 기존 검증된 패턴(`MeetingPage`의 `isDesktop ? PanelGroup : MobileTabLayout`) 차용.
- 최우선: `MeetingLivePage`(녹음) 탭 레이아웃화
- 다음: `SearchPage`, `MeetingsPage` 리스트뷰(고정폭 그리드/호버액션 수정), `MeetingViewerPage`
- 설정은 모바일 비노출이라 후순위/제외
- 공통: 터치 타깃 ≥44px, `pb-safe`, `truncate`/`line-clamp`

## 8. 인증 / 온보딩 / 서버 지정

- 가족/팀 멀티유저 → 서버모드 JWT(`AuthGuard`/`LoginPage`/`connection.rb` server_mode 기존 활용).
- 모바일 온보딩: 서버 URL 입력(기본값 프리필) → 로그인. 첫 실행 후 토큰 유지.
- **모바일은 로컬/서버 모드 선택을 묻지 않고 항상 서버모드**(로컬 백엔드 실행 불가). `IS_MOBILE`일 때 `SetupGate`/`ServerSetup`이 모드 선택 단계를 건너뛰고 곧장 서버 URL 입력(8.1 서버 목록)으로 진입하며, `getMode()`는 모바일에서 `'server'` 고정. ("로컬 실행" 옵션 비노출)

### 8.1 서버 목록 관리 (CRUD) + 전환 — 맥북 여러 대 대응

기존 단일 `server_url`(localStorage)을 **여러 서버를 리스트로 관리**하는 구조로 확장한다. 서버용 맥북이 여러 대이므로 **추가·삭제·수정·이름편집·전환**을 모두 지원한다.

**데이터 모델** (localStorage, JSON):
```ts
type ServerEntry = {
  id: string          // uuid
  label: string       // 사용자 지정 이름 (예: "거실 맥북")
  url: string         // 정규화된 base URL (예: http://10.110.14.219:13323)
  lastUsedAt?: number
}
type ServerStore = {
  servers: ServerEntry[]
  activeId: string | null   // 현재 접속 대상
}
```
- 저장 키 예: `servers`(목록) + `activeId`(활성). 기존 `server_url`은 마이그레이션(있으면 첫 항목으로 변환 후 제거).

**서버 목록 관리 화면(전용 UI)** — `ServerSetup`을 리스트 기반으로 확장 또는 `ServerManager` 신설:
- **목록 표시**: 라벨 + URL + 활성 표시 + 연결상태(헬스 점). 한 줄당 [전환] [수정] [삭제].
- **추가(Create)**: 라벨 + IP/URL 입력 → 저장 전 `/api/v1/health`로 연결 확인(기존 헬스체크 재사용) → 목록에 추가.
- **수정(Update)**: 기존 항목의 라벨·URL 편집(이름편집 포함) → 동일 헬스체크 → 저장.
- **삭제(Delete)**: 항목 제거. 활성 서버 삭제 시 `activeId`를 null로 두고 서버 선택 화면으로.
- **전환(Switch)**: 활성 서버 변경 → `getApiBaseUrl()`/`getWsUrl()`가 활성 서버 기준으로 즉시 갱신 → 서버별 세션이라 필요 시 재로그인.
- **기본값/프리필**: `config.yaml`의 `default_server_url`을 최초 진입 시 첫 항목 후보로 제시.

**`config.ts` 영향**: `getServerUrl()`을 "활성 서버의 url" 반환으로 변경하고, 목록 접근/변경 헬퍼(`listServers`, `addServer`, `updateServer`, `deleteServer`, `setActiveServer`) 추가. `getApiBaseUrl()`/`getWsUrl()`는 활성 서버 기준으로 동작(서버모드).

**권한**: 서버 목록 관리(추가/삭제/수정/전환)는 "접속 대상 지정"이므로 **모바일에서도 허용**(5장의 앱/서버 설정 잠금 대상이 아님). STT/LLM 등 서버측 설정 변경만 모바일 잠금 유지.

## 9. 빌드 / 배포

- 안드로이드: `tauri android init` → APK 빌드 → 폰 사이드로드(무료, 스토어 불필요). 선행: Mac에 Android SDK/NDK/JDK.
- PWA: 서버가 빌드된 정적 프론트 서빙 + `manifest.webmanifest` + 서비스워커. 사파리 "홈화면 추가". (외부 도메인+LE 시 무설치·무료로 iOS 마이크까지 해결)
- iOS 네이티브: 보류(필요 시 $99/년 + Xcode).

## 10. 단계별 진행

1. **연결 스파이크(핵심 가정 검증)**: `tauri android init` → 최소 앱이 LAN 서버에 붙어 마이크/API/WS가 **인증서 없이** 동작하는지 확인.
2. **모바일 UI 반응형(폰 우선)**: 녹음 화면 → 검색/목록/뷰어.
3. **권한 모델**: `IS_MOBILE` 분기로 설정 잠금 + 모바일 온보딩.
4. **PWA 폴백**: manifest + 서비스워커 + 정적 서빙, 홈화면 추가 검증(LAN은 mkcert, 외부는 도메인).
5. **APK 빌드 → 안드로이드 폰 설치 → 녹음 E2E**.
6. (나중) 외부 접속(도메인+Let's Encrypt), 태블릿/iOS PWA 다듬기.

## 11. 리스크 / 검증 포인트

- **[높음]** Tauri 안드로이드 webview의 secure-context/마이크 + 평문 LAN API/WS 동작 → 1단계 스파이크로 조기 검증. 실패 시 대안: 서버에 도메인+LE를 앞당겨 https 사용.
- iOS 홈화면 PWA의 `getUserMedia` 실기기 동작(버전별 편차).
- WebSocket(`/cable`)이 Tauri 안드로이드/PWA에서 안정적으로 연결되는지(ActionCable origin/forgery 설정 포함).
- APK 사이드로드 시 안드로이드 보안 경고/권한(마이크) 흐름.

## 12. 테스트 / 검증(E2E)

- 안드로이드 폰(Tauri): 서버 URL 입력→로그인→회의 생성→**녹음→실시간 전사→회의록 편집→이름변경→삭제** 한 사이클.
- iOS(PWA): 홈화면 추가→로그인→녹음(HTTPS 조건 충족 하에) 동작.
- 권한: 모바일에서 설정 진입점 비노출 + `/settings` 직접 접근 차단 확인.
- 회귀: PC 데스크톱(기존)에서 전 기능 정상.
- 콘솔: CORS/mixed-content/WS 에러 없음.
