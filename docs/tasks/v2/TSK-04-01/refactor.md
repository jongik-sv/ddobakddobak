# TSK-04-01 리팩토링 요약

> 날짜: 2026-04-02

## 검토 대상 파일
- `frontend/src/config.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/meetings.ts`
- `frontend/src/api/attachments.ts`
- `frontend/src/lib/actionCableAuth.ts`
- `frontend/src/hooks/useTranscription.ts`
- `frontend/src/hooks/useFileTranscriptionProgress.ts`
- `frontend/src/hooks/useAudioPlayer.ts`
- `frontend/src/pages/MeetingPage.tsx`

## 변경 사항

### 1. config.ts — getWsUrl() 서버 모드 fallback 일관성 개선
- **문제**: `getWsUrl()`에서 서버 모드이면서 `server_url`이 빈 문자열일 때, 로컬 모드 분기로 fall-through하여 `IS_TAURI` / `VITE_WS_URL` / `config.yaml` 순서로 결정되었다. 반면 `getApiBaseUrl()`은 같은 상황에서 명시적으로 `http://127.0.0.1:13323/api/v1`을 반환하여 동작이 비대칭이었다.
- **수정**: 서버 모드에서 `server_url`이 빈 문자열일 때 명시적으로 `ws://127.0.0.1:13323/cable`을 반환하도록 early return 추가. `getApiBaseUrl()`과 동일한 패턴.

### 2. useTranscription.ts — 중복 코드 제거 및 effect 통합
- **문제**: diarization 설정 객체를 조립하는 동일한 로직이 두 개의 별도 `useEffect`에 중복 존재 (subscribe 콜백 + 초기값 설정).
- **수정**:
  - `buildDiarizationConfig()` 헬퍼 함수를 추출하여 중복 제거.
  - 두 개의 `useEffect`를 하나로 통합: 초기값 설정 후 subscribe 반환.

## 변경하지 않은 이유

### api/client.ts
- 구조적 문제 없음. `getAuthHeaders()`와 ky hooks가 역할 분리되어 있음.

### api/meetings.ts, api/attachments.ts
- FormData 전송 시 `fetch` 직접 사용 + `getAuthHeaders()` 패턴이 일관적으로 적용됨.
- 불필요한 import 없음.

### lib/actionCableAuth.ts
- 13줄의 간결한 모듈. 모드 분기 로직이 명확함.

### hooks/useFileTranscriptionProgress.ts, hooks/useAudioPlayer.ts
- import 사용률 100%, 불필요한 코드 없음.

### pages/MeetingPage.tsx
- 대형 컴포넌트이나 기능 변경 범위 밖의 리팩토링은 오버엔지니어링에 해당.

## 테스트 결과
- 43 test files, 338 tests passed (vitest run)
