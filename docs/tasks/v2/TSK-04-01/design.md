# TSK-04-01: config.ts 모드 분기 설계

> API_BASE_URL, WS_URL을 로컬/서버 모드에 따라 분기

---

## 1. 현재 상태 분석

### 1.1 config.ts 동적 함수 (이미 구현됨)

`frontend/src/config.ts`에 다음 4개 함수가 이미 구현되어 있다:

| 함수 | 역할 | 상태 |
|------|------|------|
| `getMode()` | localStorage `mode` → `'local'` \| `'server'` | 완료 |
| `getServerUrl()` | localStorage `server_url` 반환 | 완료 |
| `getApiBaseUrl()` | 모드별 API URL 결정 | 완료 |
| `getWsUrl()` | 모드별 WebSocket URL 결정 | 완료 |

분기 로직 요약:

```
getApiBaseUrl()
├─ 서버 모드 + server_url 있음 → `${serverUrl}/api/v1`
├─ 서버 모드 + server_url 없음 → `http://127.0.0.1:13323/api/v1` (폴백)
├─ 로컬 모드 + IS_TAURI → `http://127.0.0.1:13323/api/v1`
└─ 로컬 모드 + 웹 → env 또는 config.yaml의 base_url

getWsUrl()
├─ 서버 모드 + server_url 있음 → https→wss, http→ws 변환 + `/cable`
├─ 서버 모드 + server_url 없음 → 로컬 fallback
├─ 로컬 모드 + IS_TAURI → `ws://127.0.0.1:13323/cable`
└─ 로컬 모드 + 웹 → env 또는 config.yaml의 ws_url
```

### 1.2 정적 상수 (호환용)

```typescript
export const API_BASE_URL = getApiBaseUrl()  // 모듈 로드 시점 고정
export const WS_URL = getWsUrl()             // 모듈 로드 시점 고정
```

이 상수들은 모듈 최초 로드 시점의 값으로 **고정**된다. 모드가 변경되면 앱이 리로드/리마운트되어야 반영된다.

### 1.3 사용처 분석

#### 동적 함수 사용 (getApiBaseUrl, getMode, getServerUrl)

| 파일 | 사용 함수 | 설명 |
|------|-----------|------|
| `api/client.ts` | `getApiBaseUrl()` | ky 인스턴스의 prefixUrl (인스턴스 생성 시 1회 호출) |
| `api/auth.ts` | `getApiBaseUrl()` | 서버 루트 URL 추출 (매 호출마다 동적) |
| `hooks/useAuth.ts` | `getMode()`, `getServerUrl()` | 로그인 URL 구성, 모드 판단 |
| `components/auth/AuthGuard.tsx` | `getMode()` | 서버 모드일 때만 인증 가드 활성화 |

#### 정적 상수 사용 (API_BASE_URL)

| 파일 | 용도 | 문제 |
|------|------|------|
| `api/meetings.ts` | `uploadAudio()`, `uploadAudioFile()` — fetch 직접 사용 | **JWT 헤더 미첨부** |
| `api/attachments.ts` | `createFileAttachment()`, `getAttachmentDownloadUrl()` — fetch 직접 사용 | **JWT 헤더 미첨부** |
| `hooks/useAudioPlayer.ts` | 오디오 URL 구성 (`new Audio()`) | **JWT 헤더 미첨부** |

#### 정적 상수 사용 (WS_URL)

| 파일 | 용도 | 문제 |
|------|------|------|
| `hooks/useTranscription.ts` | ActionCable 연결 | **JWT 토큰 미전달** |
| `hooks/useFileTranscriptionProgress.ts` | ActionCable 구독 | **JWT 토큰 미전달** |
| `pages/MeetingPage.tsx` | 회의록 재생성 감지용 ActionCable | **JWT 토큰 미전달** |

### 1.4 기존 테스트 (`config.test.ts`)

`getMode`, `getServerUrl`, `getApiBaseUrl`, `getWsUrl`의 localStorage 기반 분기를 검증하는 테스트가 이미 존재한다. 총 8개 테스트 케이스.

---

## 2. 누락된 부분 식별

### 2.1 [P0] API_BASE_URL 정적 상수를 사용하는 fetch 호출에 JWT 헤더 미첨부

`api/meetings.ts`의 `uploadAudio()`, `uploadAudioFile()`과 `api/attachments.ts`의 `createFileAttachment()`는 `apiClient`(ky) 대신 raw `fetch`를 사용한다. 이유는 `FormData` 전송 시 브라우저가 Content-Type boundary를 자동 설정하도록 하기 위함이다.

그러나 서버 모드에서는 JWT 헤더가 없으므로 401 에러가 발생한다.

**영향 범위:**
- `api/meetings.ts:146` — `uploadAudio()` (녹음 완료 후 오디오 업로드)
- `api/meetings.ts:162` — `uploadAudioFile()` (파일 업로드)
- `api/attachments.ts:45` — `createFileAttachment()` (첨부파일 업로드)

### 2.2 [P0] ActionCable 연결에 JWT 토큰 미전달

`createConsumer(WS_URL)` 호출 시 JWT 토큰을 전달하지 않는다. 서버 모드에서 ActionCable 서버가 JWT 인증을 요구하면 연결이 거부된다.

ActionCable은 URL 쿼리 파라미터로 토큰을 전달할 수 있다:
```typescript
createConsumer(`${wsUrl}?token=${accessToken}`)
```

**영향 범위:**
- `hooks/useTranscription.ts:45`
- `hooks/useFileTranscriptionProgress.ts:23`
- `pages/MeetingPage.tsx:80`

### 2.3 [P1] useAudioPlayer의 오디오 URL에 JWT 헤더 미첨부

`hooks/useAudioPlayer.ts`에서 `new Audio()`에 `API_BASE_URL` 기반 URL을 설정하는데, HTML Audio 엘리먼트는 커스텀 헤더를 설정할 수 없다. 서버 모드에서는 인증 없이 오디오 파일에 접근할 수 없다.

**해결 방안:** fetch로 blob을 가져와 `URL.createObjectURL()`로 변환하거나, URL에 토큰을 쿼리 파라미터로 첨부한다.

### 2.4 [P1] apiClient(ky) 인스턴스의 prefixUrl이 모듈 로드 시 고정

`api/client.ts`에서 `ky.create({ prefixUrl: getApiBaseUrl() })`는 모듈 로드 시점에 1회 호출된다. ServerSetup에서 모드를 변경한 후에도 기존 ky 인스턴스의 prefixUrl은 변경 전 값을 유지한다.

현재 코드의 주석(`// 주의: 이 상수들은 모듈 로드 시점의 값으로 고정된다.`)에서 이 제약을 인지하고 있으며, "앱이 리로드/리마운트되어야 반영된다"고 명시되어 있다. ServerSetup 완료 후 `window.location.reload()`가 호출되면 이 문제는 해소된다.

**현재 대응:** ServerSetup에서 설정 저장 후 `window.location.reload()` 호출을 보장하면 추가 작업 불필요.

### 2.5 [P2] getAttachmentDownloadUrl의 정적 URL

`api/attachments.ts`의 `getAttachmentDownloadUrl()`은 `API_BASE_URL`로 정적 URL 문자열을 반환한다. 이 URL이 `<a href>` 등에 사용되면 JWT 헤더 없이 브라우저가 직접 요청하게 된다.

---

## 3. 구현 계획

### 3.1 수정 대상 파일

| 파일 | 수정 내용 | 우선순위 |
|------|-----------|----------|
| `api/meetings.ts` | fetch 호출에 JWT 헤더 추가 | P0 |
| `api/attachments.ts` | fetch 호출에 JWT 헤더 추가 + 다운로드 URL 동적화 | P0 |
| `hooks/useTranscription.ts` | ActionCable에 JWT 토큰 전달 | P0 |
| `hooks/useFileTranscriptionProgress.ts` | ActionCable에 JWT 토큰 전달 | P0 |
| `pages/MeetingPage.tsx` | ActionCable에 JWT 토큰 전달 | P0 |
| `hooks/useAudioPlayer.ts` | 인증된 오디오 URL 로드 | P1 |
| `config.ts` | 서버 모드 + server_url 미설정 시 경고 로그 추가 | P2 |

### 3.2 구현 세부사항

#### 3.2.1 fetch 호출에 JWT 헤더 추가

`authStore`에서 accessToken을 가져와 fetch 헤더에 포함하는 헬퍼 함수를 만든다.

```typescript
// api/client.ts에 추가
export function getAuthHeaders(): HeadersInit {
  const { accessToken } = useAuthStore.getState()
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}
```

`api/meetings.ts`, `api/attachments.ts`의 raw fetch 호출에 헤더를 추가한다:

```typescript
await fetch(url, {
  method: 'POST',
  headers: { ...getAuthHeaders() },  // Content-Type은 FormData에서 자동 설정
  body: formData,
})
```

#### 3.2.2 ActionCable JWT 토큰 전달

인증 토큰을 포함한 ActionCable consumer를 생성하는 헬퍼를 만든다.

```typescript
// lib/actionCableAuth.ts (신규)
import { createConsumer } from '@rails/actioncable'
import { getWsUrl } from '../config'
import { useAuthStore } from '../stores/authStore'
import { getMode } from '../config'

export function createAuthenticatedConsumer() {
  const wsUrl = getWsUrl()
  if (getMode() !== 'server') {
    return createConsumer(wsUrl)
  }
  const { accessToken } = useAuthStore.getState()
  const url = accessToken
    ? `${wsUrl}?token=${encodeURIComponent(accessToken)}`
    : wsUrl
  return createConsumer(url)
}
```

3개 사용처를 `createConsumer(WS_URL)` → `createAuthenticatedConsumer()`로 교체한다.

#### 3.2.3 오디오 플레이어 인증 로드

`useAudioPlayer.ts`에서 fetch + blob URL 방식으로 변경한다:

```typescript
// 서버 모드: fetch로 blob을 가져와 objectURL 생성
// 로컬 모드: 기존 방식 유지 (직접 URL 설정)
const audioUrl = `${getApiBaseUrl()}/meetings/${meetingId}/audio`
if (getMode() === 'server') {
  const { accessToken } = useAuthStore.getState()
  const response = await fetch(audioUrl, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })
  const blob = await response.blob()
  audio.src = URL.createObjectURL(blob)
} else {
  audio.src = audioUrl
}
```

#### 3.2.4 정적 상수 → 동적 함수 전환 (선택적)

현재 `API_BASE_URL`과 `WS_URL` 정적 상수를 사용하는 곳을 `getApiBaseUrl()`과 `getWsUrl()` 동적 함수 호출로 전환하는 것을 검토한다. ServerSetup 후 `window.location.reload()`로 앱이 완전히 리로드되므로 실질적 차이는 없지만, 코드 일관성을 위해 전환하는 것이 바람직하다.

다만 이 작업은 기능적 변경이 아니므로 P2로 분류한다.

### 3.3 신규 파일

| 파일 | 설명 |
|------|------|
| `frontend/src/lib/actionCableAuth.ts` | 인증된 ActionCable consumer 생성 헬퍼 |

### 3.4 기존 config.ts 모드 분기 결론

**config.ts의 모드 분기 자체는 완전하다.** `getMode()`, `getServerUrl()`, `getApiBaseUrl()`, `getWsUrl()` 함수들은 TRD 2.3의 요구사항을 충족한다.

문제는 config.ts가 아니라 **config.ts에서 제공하는 URL을 사용하는 파일들**에서 서버 모드의 인증 요구사항(JWT 헤더, ActionCable 토큰)을 반영하지 않는 점이다. 이 TSK에서는 이러한 사용처들을 서버 모드에서도 올바르게 동작하도록 수정한다.

---

## 4. 테스트 계획

### 4.1 기존 테스트 유지

`frontend/src/__tests__/config.test.ts` — getMode/getServerUrl/getApiBaseUrl/getWsUrl 분기 테스트 (8개) 유지.

### 4.2 신규 테스트

#### 4.2.1 단위 테스트

| 테스트 | 파일 | 검증 내용 |
|--------|------|-----------|
| getAuthHeaders | `__tests__/client.test.ts` | accessToken 존재 시 Authorization 헤더 포함, 없으면 빈 객체 |
| createAuthenticatedConsumer | `__tests__/actionCableAuth.test.ts` | 서버 모드에서 토큰 쿼리 파라미터 포함, 로컬 모드에서 미포함 |
| uploadAudio (서버 모드) | `api/__tests__/meetings.test.ts` | fetch 호출 시 Authorization 헤더 포함 확인 |
| createFileAttachment (서버 모드) | `api/__tests__/attachments.test.ts` | fetch 호출 시 Authorization 헤더 포함 확인 |

#### 4.2.2 수동 검증 (E2E)

| 시나리오 | 검증 항목 |
|----------|-----------|
| 로컬 모드 기존 동작 | 녹음 → 전사 → 요약 전체 흐름 정상 |
| 서버 모드 API 호출 | 서버 URL로 meetings API 호출 성공 |
| 서버 모드 ActionCable | 서버 URL로 실시간 전사 수신 성공 |
| 서버 모드 오디오 업로드 | FormData + JWT 헤더로 오디오 업로드 성공 |
| 서버 모드 오디오 재생 | 인증된 오디오 URL로 재생 성공 |
| 토큰 만료 시 URL | refresh 후 올바른 서버 URL로 재요청 |

---

## 5. 의존성 및 제약사항

- **TSK-02-02** (서버 URL 설정 UI): 이미 완료. localStorage에 mode, server_url 저장 로직 구현됨.
- **TSK-01-03** (서버 모드 분기 - 백엔드): ActionCable의 JWT 인증 처리가 백엔드에 구현되어야 함. `token` 쿼리 파라미터로 JWT를 받아 인증하는 로직 필요.
- **앱 리로드 전제:** ServerSetup에서 모드 변경 후 `window.location.reload()`가 호출되어야 정적 상수와 ky 인스턴스가 새 값을 반영한다.
