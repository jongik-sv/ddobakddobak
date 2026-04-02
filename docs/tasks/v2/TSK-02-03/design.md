# TSK-02-03: 로그인 흐름 구현 - 설계 문서

> 서버 모드에서 브라우저 로그인 -> 딥링크 토큰 수신 -> JWT 인증 기반 API 호출까지의 전체 프론트엔드 인증 흐름

---

## 1. 개요

### 1.1 목표

Tauri 앱이 서버 모드일 때 아래 인증 흐름을 완성한다:

```
앱 시작 → 토큰 유효성 검증 → (유효) → 메인 화면
                              → (만료) → refresh → (성공) → 메인 화면
                                                  → (실패) → 로그인 화면
         → 토큰 없음 → 로그인 화면
              → 로그인 버튼 클릭 → 브라우저 open(serverUrl + '/auth/web_login?callback=ddobak://')
              → 서버 인증 성공 → ddobak://callback?access_token=xxx&refresh_token=yyy
              → Tauri 딥링크 수신 → authStore 저장 → 메인 화면
```

### 1.2 신규 파일

| 파일 | 역할 |
|------|------|
| `frontend/src/stores/authStore.ts` | Zustand 인증 상태 스토어 |
| `frontend/src/api/auth.ts` | 인증 관련 API 모듈 |
| `frontend/src/hooks/useAuth.ts` | 인증 흐름 오케스트레이션 훅 |
| `frontend/src/components/auth/LoginPage.tsx` | 로그인 페이지 컴포넌트 |

### 1.3 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `frontend/src/api/client.ts` | JWT Authorization 헤더 자동 첨부, 401 자동 갱신 |
| `frontend/src/config.ts` | mode/server_url 기반 API_BASE_URL, WS_URL 분기 |
| `frontend/src/hooks/useDeepLink.ts` | authStore 연동 (access_token + refresh_token) |
| `frontend/src/lib/deepLinkParser.ts` | refresh_token 파싱 추가 |

---

## 2. authStore (Zustand)

### 2.1 파일: `frontend/src/stores/authStore.ts`

```typescript
import { create } from 'zustand'

interface AuthState {
  // ── State ──
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean  // 앱 시작 시 토큰 검증 중 로딩 상태

  // ── Actions ──
  setTokens: (accessToken: string, refreshToken: string) => void
  setAccessToken: (accessToken: string) => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
}

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  isAuthenticated: false,
  isLoading: true,

  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    set({ accessToken, refreshToken, isAuthenticated: true })
  },

  setAccessToken: (accessToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    set({ accessToken })
  },

  clearAuth: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    set({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
  },

  setLoading: (loading) => set({ isLoading: loading }),
}))
```

### 2.2 설계 결정

- **localStorage 동기화**: `setTokens`/`clearAuth` 호출 시 localStorage와 Zustand state를 동시에 업데이트한다. 앱 재시작 시 localStorage에서 초기값을 복원한다.
- **isLoading**: 앱 시작 시 `true`로 시작. `useAuth` 훅에서 토큰 검증 완료 후 `false`로 변경. 이 동안 스플래시/로딩 UI를 표시한다.
- **isAuthenticated**: 토큰 존재 여부가 아닌, 서버 검증 완료 후에만 `true`로 설정한다. 초기값은 `false`이며, 앱 시작 시 `useAuth`에서 검증 후 설정한다.

---

## 3. API 클라이언트 수정

### 3.1 파일: `frontend/src/api/client.ts`

```typescript
import ky from 'ky'
import { getApiBaseUrl } from '../config'
import { useAuthStore } from '../stores/authStore'
import { refreshAccessToken } from './auth'

// prefixUrl을 동적으로 결정하기 위해 함수로 래핑
export const apiClient = ky.create({
  prefixUrl: getApiBaseUrl(),
  hooks: {
    beforeRequest: [
      (request) => {
        const { accessToken } = useAuthStore.getState()
        if (accessToken) {
          request.headers.set('Authorization', `Bearer ${accessToken}`)
        }
      },
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status !== 401) return response

        // 401 수신 시 refresh 시도
        const { refreshToken } = useAuthStore.getState()
        if (!refreshToken) {
          useAuthStore.getState().clearAuth()
          return response
        }

        try {
          const { access_token } = await refreshAccessToken(refreshToken)
          useAuthStore.getState().setAccessToken(access_token)

          // 원래 요청을 새 토큰으로 재시도
          request.headers.set('Authorization', `Bearer ${access_token}`)
          return ky(request, options)
        } catch {
          // refresh 실패 → 로그아웃
          useAuthStore.getState().clearAuth()
          return response
        }
      },
    ],
  },
})

export default apiClient
```

### 3.2 설계 결정

- **beforeRequest hook**: 모든 요청에 `Authorization: Bearer {token}` 헤더를 자동 첨부한다. `useAuthStore.getState()`로 최신 토큰을 가져온다 (React 컴포넌트 외부에서도 동작).
- **afterResponse hook**: 401 응답 시 refresh_token으로 새 access_token을 발급받고, 원래 요청을 재시도한다. refresh도 실패하면 `clearAuth()`로 로그아웃 처리.
- **순환 참조 방지**: `refreshAccessToken`은 별도의 ky 인스턴스(또는 bare fetch)를 사용하여 apiClient의 afterResponse hook이 재귀 호출되지 않도록 한다.
- **기존 코드 호환**: apiClient의 인터페이스(사용법)는 변경 없음. 기존의 `apiClient.get('meetings/...')` 호출이 그대로 동작한다.

### 3.3 주의사항: 동시 401 처리

여러 API 호출이 동시에 401을 받는 경우 refresh가 중복 호출될 수 있다. 이를 방지하기 위해 refresh를 Promise로 싱글턴화한다:

```typescript
let refreshPromise: Promise<string> | null = null

async function getOrRefreshToken(refreshToken: string): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(refreshToken)
      .then((res) => {
        refreshPromise = null
        return res.access_token
      })
      .catch((err) => {
        refreshPromise = null
        throw err
      })
  }
  return refreshPromise
}
```

---

## 4. auth API 모듈

### 4.1 파일: `frontend/src/api/auth.ts`

```typescript
import ky from 'ky'
import { getApiBaseUrl } from '../config'

/**
 * 인증 전용 ky 인스턴스.
 * apiClient의 afterResponse hook(401 자동 갱신)이 적용되지 않도록
 * 별도 인스턴스를 사용한다.
 */
function authBaseUrl(): string {
  // auth 엔드포인트는 /api/v1이 아닌 /auth 경로
  // getApiBaseUrl()은 "https://server.com/api/v1"을 반환하므로
  // 서버 루트를 추출한다.
  const apiBase = getApiBaseUrl()
  return apiBase.replace(/\/api\/v1\/?$/, '')
}

// ── Refresh Token ──
export interface RefreshResponse {
  access_token: string
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<RefreshResponse> {
  return ky
    .post('auth/refresh', {
      prefixUrl: authBaseUrl(),
      json: { refresh_token: refreshToken },
    })
    .json<RefreshResponse>()
}

// ── Logout ──
export async function logout(accessToken: string): Promise<void> {
  await ky.delete('auth/logout', {
    prefixUrl: authBaseUrl(),
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

// ── Validate (서버에 인증된 요청을 보내 토큰 유효성 확인) ──
export interface ValidateResponse {
  user: { id: number; email: string; name: string }
}

export async function validateToken(
  accessToken: string
): Promise<ValidateResponse> {
  // 별도 validate 엔드포인트 없이, 기존 API에 인증 요청을 보내 확인
  // /api/v1/settings는 가볍고 인증 필수인 엔드포인트
  return ky
    .get('api/v1/health', {
      prefixUrl: authBaseUrl(),
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    .json<ValidateResponse>()
}
```

### 4.2 설계 결정

- **별도 ky 인스턴스**: apiClient를 사용하면 afterResponse hook이 무한루프를 일으킬 수 있으므로, bare `ky`를 직접 사용한다.
- **auth 경로**: 서버의 인증 엔드포인트는 `/auth/refresh`, `/auth/logout`이다 (`/api/v1` 네임스페이스 외부). `authBaseUrl()`에서 서버 루트 URL을 추출한다.
- **토큰 검증**: 별도 `/auth/validate` 엔드포인트가 현재 서버에 없으므로, `/api/v1/health` 엔드포인트에 인증 헤더를 포함해 호출한다. 인증이 유효하면 200, 만료/무효하면 401이 반환된다.
  - 서버 모드에서 health 엔드포인트도 인증 필수이므로 검증 용도로 적합.
  - 추후 별도 `/auth/validate` 엔드포인트 추가 시 교체 가능.

### 4.3 서버 응답 형식 (참고)

```
POST /auth/refresh  { refresh_token: "xxx" }
→ 200 { access_token: "yyy" }
→ 401 { error: "Invalid refresh token" }

DELETE /auth/logout
→ 200 { message: "logged out" }
→ 401 (미인증)
```

---

## 5. config.ts 수정

### 5.1 파일: `frontend/src/config.ts`

```typescript
// ── Tauri 환경 감지 (기존 유지) ─────────────────
export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// ── 모드 / 서버 URL ─────────────────────────────
export function getMode(): 'local' | 'server' {
  const mode = localStorage.getItem('mode')
  return mode === 'server' ? 'server' : 'local'
}

export function getServerUrl(): string {
  return localStorage.getItem('server_url') || ''
}

// ── API / WebSocket URL 동적 결정 ────────────────
export function getApiBaseUrl(): string {
  if (getMode() === 'server') {
    const serverUrl = getServerUrl()
    return serverUrl ? `${serverUrl}/api/v1` : 'http://127.0.0.1:13323/api/v1'
  }
  // 로컬 모드: Tauri는 항상 13323, 웹 dev는 환경변수 또는 config.yaml
  return IS_TAURI
    ? 'http://127.0.0.1:13323/api/v1'
    : import.meta.env.VITE_API_BASE_URL || cfg.api.base_url
}

export function getWsUrl(): string {
  if (getMode() === 'server') {
    const serverUrl = getServerUrl()
    if (serverUrl) {
      return serverUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://') + '/cable'
    }
  }
  return IS_TAURI
    ? 'ws://127.0.0.1:13323/cable'
    : import.meta.env.VITE_WS_URL || cfg.api.ws_url
}

// ── 하위 호환용 상수 (기존 코드 사용처 대응) ──────
// 주의: 이 상수들은 모듈 로드 시점의 값으로 고정된다.
// ServerSetup 완료 후 모드가 변경되면 앱이 리로드/리마운트되어야 반영된다.
export const API_BASE_URL = getApiBaseUrl()
export const WS_URL = getWsUrl()

// ── 나머지 기존 exports 유지 (ENGINE_LABELS, AUDIO 등) ──
```

### 5.2 설계 결정

- **함수형 getter 추가**: `getApiBaseUrl()`, `getWsUrl()`을 함수로 제공하여, 런타임에 localStorage 값이 변경된 후에도 최신 URL을 가져올 수 있게 한다.
- **기존 상수 호환**: `API_BASE_URL`, `WS_URL` 상수 export를 유지하여 기존 코드(13개 API 모듈 + ActionCable)가 수정 없이 동작한다. 이 상수들은 모듈 로드 시점에 평가된다.
- **앱 리로드 전략**: ServerSetup 완료 시 `onComplete` 콜백에서 `window.location.reload()`를 호출하여 config 상수가 재평가되도록 한다. 이는 기존 ServerSetup 코드의 `onComplete` 흐름과 자연스럽게 맞물린다.
- **IS_TAURI 호환**: 기존 IS_TAURI 감지 로직을 그대로 유지한다.

---

## 6. deepLinkParser 수정

### 6.1 파일: `frontend/src/lib/deepLinkParser.ts`

```typescript
export interface DeepLinkResult {
  type: 'callback'
  accessToken: string
  refreshToken: string
}

export function parseDeepLink(url: string): DeepLinkResult | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'ddobak:') return null
    if (parsed.hostname !== 'callback') return null

    const accessToken = parsed.searchParams.get('access_token')
    const refreshToken = parsed.searchParams.get('refresh_token')
    if (!accessToken || !refreshToken) return null

    return { type: 'callback', accessToken, refreshToken }
  } catch {
    return null
  }
}
```

### 6.2 변경 사항

- `token` 단일 필드 -> `accessToken` + `refreshToken` 두 필드로 변경.
- 서버의 `BrowserSessionsController#build_callback_url`이 `access_token`과 `refresh_token` 두 파라미터를 포함한 딥링크 URL을 생성하므로 (`ddobak://callback?access_token=xxx&refresh_token=yyy`), 이에 맞게 파싱 로직을 업데이트한다.

---

## 7. useDeepLink 수정

### 7.1 파일: `frontend/src/hooks/useDeepLink.ts`

```typescript
import { useEffect } from 'react'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { parseDeepLink } from '../lib/deepLinkParser'
import { useAuthStore } from '../stores/authStore'

export function useDeepLink(): void {
  const setTokens = useAuthStore((s) => s.setTokens)

  useEffect(() => {
    const unlisten = onOpenUrl((urls: string[]) => {
      for (const url of urls) {
        const result = parseDeepLink(url)
        if (result) {
          setTokens(result.accessToken, result.refreshToken)
          break
        }
      }
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setTokens])
}
```

### 7.2 변경 사항

- 기존: `localStorage.setItem('access_token', result.token)` + `onToken` 콜백
- 변경: `authStore.setTokens(accessToken, refreshToken)` 호출로 통합
- `onToken` 콜백 파라미터를 제거하고 authStore를 직접 사용. 토큰 수신 시 authStore가 업데이트되면 React 컴포넌트들이 자동으로 반응한다.

---

## 8. useAuth 훅

### 8.1 파일: `frontend/src/hooks/useAuth.ts`

```typescript
import { useEffect, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { useAuthStore } from '../stores/authStore'
import { useDeepLink } from './useDeepLink'
import { refreshAccessToken, logout as logoutApi, validateToken } from '../api/auth'
import { getMode, getServerUrl } from '../config'

export function useAuth() {
  const {
    accessToken,
    refreshToken,
    isAuthenticated,
    isLoading,
    setTokens,
    setAccessToken,
    clearAuth,
    setLoading,
  } = useAuthStore()

  // 딥링크 리스너 등록
  useDeepLink()

  // ── 앱 시작 시 토큰 검증 ──
  useEffect(() => {
    if (getMode() !== 'server') {
      // 로컬 모드: 인증 불필요
      setLoading(false)
      return
    }

    if (!accessToken) {
      // 토큰 없음 → 로그인 필요
      setLoading(false)
      return
    }

    // 토큰 유효성 검증
    validateToken(accessToken)
      .then(() => {
        // 유효 → 인증 완료
        useAuthStore.getState().setTokens(
          accessToken,
          refreshToken || ''
        )
        setLoading(false)
      })
      .catch(async () => {
        // 만료 → refresh 시도
        if (refreshToken) {
          try {
            const { access_token } = await refreshAccessToken(refreshToken)
            setAccessToken(access_token)
            useAuthStore.setState({ isAuthenticated: true })
            setLoading(false)
          } catch {
            clearAuth()
          }
        } else {
          clearAuth()
        }
      })
  }, []) // 앱 시작 시 1회만 실행

  // ── 로그인: 브라우저로 서버 로그인 페이지 열기 ──
  const login = useCallback(() => {
    const serverUrl = getServerUrl()
    const loginUrl = `${serverUrl}/auth/web_login?callback=ddobak://`
    open(loginUrl)
  }, [])

  // ── 로그아웃 ──
  const logout = useCallback(async () => {
    if (accessToken) {
      try {
        await logoutApi(accessToken)
      } catch {
        // 서버 로그아웃 실패해도 로컬 토큰은 삭제
      }
    }
    clearAuth()
  }, [accessToken, clearAuth])

  return {
    isAuthenticated,
    isLoading,
    login,
    logout,
  }
}
```

### 8.2 설계 결정

- **초기화 흐름**: 앱 시작 시 `useEffect([], ...)`에서 토큰 검증을 수행한다. 검증 완료까지 `isLoading: true`로 로딩 UI를 표시한다.
- **딥링크 통합**: `useDeepLink()`를 내부에서 호출하여, 로그인 페이지가 마운트된 동안 딥링크 수신을 리스닝한다. 토큰이 수신되면 authStore가 업데이트되고, `isAuthenticated`가 `true`로 바뀌면서 로그인 화면이 자동으로 메인 화면으로 전환된다.
- **로그아웃**: 서버에 `DELETE /auth/logout`을 보내 토큰을 무효화한 뒤, 로컬 토큰을 삭제한다. 서버 요청 실패 시에도 로컬 토큰은 반드시 삭제한다.
- **open()**: Tauri 2 `@tauri-apps/plugin-shell`의 `open()`을 사용하여 기본 브라우저에서 로그인 URL을 연다.

---

## 9. LoginPage 컴포넌트

### 9.1 파일: `frontend/src/components/auth/LoginPage.tsx`

```typescript
import { Loader2, LogIn } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export function LoginPage() {
  const { login, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100
                      flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-slate-500">인증 확인 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100
                    flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">또박또박</h1>
          <p className="text-slate-500">AI 회의록 - 로그인이 필요합니다</p>
        </div>

        {/* 로그인 버튼 */}
        <button
          type="button"
          onClick={login}
          className="w-full flex items-center justify-center gap-2 py-3
                     rounded-xl bg-blue-600 text-white font-semibold
                     hover:bg-blue-700 transition-colors cursor-pointer"
        >
          <LogIn className="w-5 h-5" />
          브라우저에서 로그인
        </button>

        <p className="text-sm text-slate-400 text-center mt-4">
          기본 브라우저에서 로그인 페이지가 열립니다.
          <br />
          로그인 완료 후 자동으로 돌아옵니다.
        </p>
      </div>
    </div>
  )
}
```

### 9.2 설계 결정

- **단순한 UI**: 로그인 폼이 서버 측 브라우저 페이지에 있으므로, 앱 내 LoginPage는 "브라우저에서 로그인" 버튼만 제공한다.
- **로딩 상태**: `isLoading`이 `true`일 때 스피너를 표시한다 (앱 시작 시 토큰 검증 중).
- **자동 전환**: 딥링크로 토큰이 수신되면 `isAuthenticated`가 `true`로 변경되고, 상위 라우팅에서 메인 화면으로 자동 전환된다 (TSK-02-04에서 구현할 인증 가드).
- **Tailwind + lucide-react**: 기존 프로젝트의 스타일링 패턴(ServerSetup.tsx 참고)을 따른다.

---

## 10. 기존 코드 연동 포인트

### 10.1 연동 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│ App.tsx                                                       │
│  ├─ SetupGate (기존)                                          │
│  │    └─ ServerSetup → localStorage에 mode/server_url 저장     │
│  │        └─ onComplete → window.location.reload()            │
│  │           (config.ts 상수 재평가)                            │
│  │                                                            │
│  ├─ LoginPage (신규, TSK-02-04에서 라우팅 가드로 분기)           │
│  │    └─ useAuth()                                            │
│  │        ├─ useDeepLink() → authStore.setTokens()            │
│  │        ├─ login() → open(브라우저)                          │
│  │        └─ logout() → authStore.clearAuth()                 │
│  │                                                            │
│  └─ Routes (기존)                                             │
│       └─ apiClient (수정)                                      │
│            ├─ beforeRequest: Authorization 헤더 자동 첨부       │
│            └─ afterResponse: 401 → refresh → 재시도            │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 ServerSetup.tsx 연동

- ServerSetup은 mode/server_url을 localStorage에 저장한 뒤 `onComplete()`를 호출한다.
- **변경 없음**. ServerSetup의 역할(모드 선택 + URL 설정)은 그대로 유지한다.
- ServerSetup 완료 후 config.ts가 새 URL을 반영하도록, SetupGate에서 `onComplete` 시 `window.location.reload()`를 호출한다 (또는 config를 함수형으로 변경).

### 10.3 useDeepLink.ts 연동

- **기존**: `localStorage.setItem('access_token', token)` + `onToken` 콜백
- **변경**: `authStore.setTokens(accessToken, refreshToken)` 호출
- `onToken` 콜백 파라미터를 제거. authStore 구독을 통해 React 컴포넌트가 자동으로 반응한다.

### 10.4 client.ts 연동

- **기존**: `ky.create({ prefixUrl: API_BASE_URL })` — 헤더 없음
- **변경**: `beforeRequest`/`afterResponse` hook 추가
- 기존 API 모듈(meetings.ts, folders.ts 등)은 `apiClient`를 import하여 사용하므로, client.ts 내부 변경만으로 모든 API 호출에 인증이 적용된다.

### 10.5 config.ts 연동

- **기존**: `API_BASE_URL`/`WS_URL`이 IS_TAURI 기반으로 localhost 고정
- **변경**: `getMode()`에 따라 서버 URL 또는 localhost를 반환
- 기존 상수 export(`API_BASE_URL`, `WS_URL`)를 유지하여 하위 호환성 보장

### 10.6 ActionCable (WebSocket) 연동

- ActionCable 연결 시 WS_URL이 서버 모드에서는 `wss://서버주소/cable`로 설정됨
- 서버 모드에서 ActionCable 연결에도 인증이 필요할 수 있음 → 이는 TSK-02-04 또는 후속 작업에서 처리 (현재 ActionCable은 쿼리 파라미터로 토큰 전달하는 방식이 일반적)

---

## 11. 로컬 모드 호환성

### 11.1 원칙

- 로컬 모드(`mode === 'local'`)에서는 인증 흐름이 **완전히 비활성화**된다.
- authStore의 `isLoading`은 즉시 `false`, `isAuthenticated`는 무시된다.
- apiClient의 beforeRequest hook은 `accessToken`이 `null`이면 헤더를 추가하지 않는다.
- 로컬 모드 서버는 `DefaultUserLookup`으로 `desktop@local` 사용자를 자동 생성하므로 인증 없이 API 접근이 가능하다.

### 11.2 영향 받지 않는 기존 기능

| 기능 | 영향 |
|------|------|
| SetupPage (환경 확인/설치) | 변경 없음 |
| 실시간 녹음/전사 | apiClient 수정으로 자동 적용 |
| AI 요약 | apiClient 수정으로 자동 적용 |
| 블록 에디터 | 변경 없음 |
| 폴더/태그 관리 | apiClient 수정으로 자동 적용 |
| 설정 모달 | 변경 없음 |

---

## 12. 에러 처리

| 시나리오 | 처리 |
|---------|------|
| 딥링크 토큰 파싱 실패 | 무시 (잘못된 URL) |
| 토큰 검증 실패 + refresh 실패 | `clearAuth()` → 로그인 화면 |
| 서버 연결 불가 (네트워크 오류) | 로딩 상태 유지 또는 에러 표시 (재시도 버튼) |
| 로그아웃 API 실패 | 로컬 토큰만 삭제 (서버 측 토큰은 만료 시 자연 소멸) |
| 브라우저 열기 실패 | 사용자에게 URL 복사 안내 |

---

## 13. 구현 순서

1. **deepLinkParser.ts 수정** — refresh_token 파싱 추가
2. **config.ts 수정** — `getMode()`, `getApiBaseUrl()`, `getWsUrl()` 함수 추가
3. **authStore.ts 생성** — Zustand 인증 상태 스토어
4. **auth.ts API 모듈 생성** — refresh, logout, validate 함수
5. **client.ts 수정** — beforeRequest/afterResponse hook
6. **useDeepLink.ts 수정** — authStore 연동
7. **useAuth.ts 생성** — 인증 흐름 오케스트레이션
8. **LoginPage.tsx 생성** — 로그인 UI
9. **단위 테스트** — authStore, deepLinkParser, auth API 모듈
