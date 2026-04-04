# TSK-02-02: 서버 URL 설정 UI - 설계

## 구현 방향
- 앱 첫 실행 시 "로컬 실행" / "서버 연결" 모드 선택 UI를 제공한다.
- 서버 모드 선택 시 서버 URL 입력 필드와 헬스체크(연결 확인) 기능을 제공한다.
- 설정(mode, server_url)을 localStorage에 저장하여 앱 재시작 시 유지한다.
- config.ts에서 mode에 따라 API/WebSocket URL을 동적으로 분기한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/auth/ServerSetup.tsx` | 모드 선택 + 서버 URL 입력 + 헬스체크 UI 컴포넌트 | 신규 |
| `frontend/src/config.ts` | `getMode()`, `getServerUrl()`, `getApiBaseUrl()`, `getWsUrl()` - 모드별 API/WS URL 동적 결정 | 수정 |
| `frontend/src/components/SetupGate.tsx` | 서버 모드일 때 로컬 환경 셋업(SetupPage)을 건너뛰는 게이트 로직 | 수정 |
| `frontend/src/api/client.ts` | ky 인스턴스 - 서버 모드 시 JWT Authorization 헤더 자동 첨부 | 수정 |
| `frontend/src/components/auth/__tests__/ServerSetup.test.tsx` | ServerSetup 컴포넌트 단위 테스트 | 신규 |

## 주요 구조

- **`ServerSetup` 컴포넌트**: 모드 선택 카드(로컬/서버), 서버 URL 입력, 헬스체크 버튼, 상태 표시(checking/success/error), 시작하기 버튼. `onComplete` 콜백으로 부모에 완료 통보
- **`getMode()` / `getServerUrl()` (config.ts)**: localStorage에서 `mode`, `server_url`을 읽어 반환. 모드 미설정 시 기본값 `'local'`
- **`getApiBaseUrl()` / `getWsUrl()` (config.ts)**: 서버 모드 시 사용자 입력 URL 기반으로 API/WS 엔드포인트를 동적 생성, 로컬 모드 시 `localhost:13323` 고정
- **`SetupGate` 컴포넌트**: 서버 모드(`getMode() === 'server'`)이면 로컬 환경 셋업(Ruby/Python 체크) 단계를 건너뜀
- **`normalizeUrl()` 유틸**: 후행 슬래시 제거하여 URL 정규화

## 데이터 흐름
사용자 모드 선택 + URL 입력 --> `fetch(serverUrl/api/v1/health)` 헬스체크 --> 성공 시 `localStorage.setItem('mode', 'server')` + `localStorage.setItem('server_url', url)` 저장 --> `config.ts`의 `getApiBaseUrl()`/`getWsUrl()`이 저장된 값을 읽어 API 클라이언트에 전달

## 선행 조건
- 없음 (TSK-02-02는 프론트엔드 단독 구현 가능, 서버 `/api/v1/health` 엔드포인트는 기존 Rails에 존재)
