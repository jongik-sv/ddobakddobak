# TSK-02-04: 라우팅 인증 가드 설계

> 서버 모드에서 미인증 사용자의 페이지 접근을 차단하고, 로컬 모드에서는 기존 동작을 유지한다.

**작성일:** 2026-04-02
**상태:** Design Done
**참조:** TRD 2.4, PRD 3.1.1

---

## 1. 현재 구조 분석

### 1.1 App.tsx 라우트 구조

```
App
 └─ SetupGate (Tauri 프로덕션에서만 SetupPage 표시)
     ├─ / → /meetings 리다이렉트
     ├─ /dashboard → AppLayout > DashboardPage
     ├─ /meetings → AppLayout > MeetingsPage
     ├─ /meetings/:id/live → AppLayout > MeetingLivePage
     ├─ /meetings/:id → AppLayout > MeetingPage
     ├─ /settings → SettingsRedirect (모달 열기 후 /meetings로)
     └─ * → /meetings 리다이렉트
```

- `SetupGate`는 Tauri 프로덕션 환경에서만 `SetupPage`를 표시한다 (웹 dev, tauri dev에서는 스킵).
- 인증 관련 가드는 존재하지 않는다.
- 모든 라우트가 동일한 레벨에 flat하게 정의되어 있다.

### 1.2 인증 상태 관리 (authStore)

- `isAuthenticated` (boolean) -- 인증 완료 여부
- `isLoading` (boolean) -- 앱 시작 시 토큰 검증 중 로딩 상태
- `accessToken` / `refreshToken` -- localStorage + Zustand 동기화

### 1.3 useAuth 훅

- 앱 시작 시 `useEffect`에서 모드 판단 후 토큰 검증/갱신 수행
- `getMode() !== 'server'`이면 `setLoading(false)`로 즉시 종료 (로컬 모드 패스)
- 로그인/로그아웃 콜백 제공

### 1.4 config.ts 모드 분기

- `getMode()` / `getServerUrl()` 함수로 동적 URL 결정 (이미 구현 완료)
- `API_BASE_URL` / `WS_URL` 상수는 모듈 로드 시점 고정 (하위 호환용)
- 모드 변경 후 앱 리로드 필요

---

## 2. 설계

### 2.1 AuthGuard 컴포넌트

`frontend/src/components/auth/AuthGuard.tsx` 신규 생성.

```tsx
// frontend/src/components/auth/AuthGuard.tsx
import { Loader2 } from 'lucide-react'
import { getMode } from '../../config'
import { useAuth } from '../../hooks/useAuth'
import { LoginPage } from './LoginPage'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * 서버 모드에서 인증되지 않은 사용자를 LoginPage로 차단한다.
 * 로컬 모드에서는 children을 그대로 렌더링한다 (가드 없음).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth()

  // 로컬 모드: 인증 가드 없이 바로 통과
  if (getMode() !== 'server') {
    return <>{children}</>
  }

  // 서버 모드: 토큰 검증 중 로딩 표시
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-slate-500">인증 확인 중...</p>
        </div>
      </div>
    )
  }

  // 서버 모드 + 미인증: 로그인 페이지 표시
  if (!isAuthenticated) {
    return <LoginPage />
  }

  // 서버 모드 + 인증 완료: 메인 화면 접근 허용
  return <>{children}</>
}
```

#### 설계 판단

| 항목 | 결정 | 근거 |
|------|------|------|
| Navigate vs 컴포넌트 직접 렌더링 | LoginPage 직접 렌더링 | /login 라우트를 별도로 만들 필요 없음. 미인증 시 어떤 URL이든 LoginPage를 보여주면 됨. 딥링크 콜백 후 isAuthenticated가 true로 바뀌면 자동으로 원래 라우트 컨텐츠가 렌더링됨. |
| 로딩 UI 중복 | AuthGuard 내부에서 로딩 처리 | LoginPage 내부의 isLoading 분기와 동일한 UI이지만, AuthGuard가 상위에서 먼저 로딩을 처리하므로 LoginPage의 로딩 분기에는 도달하지 않음. |
| useAuth 호출 위치 | AuthGuard 내부 | useAuth가 useDeepLink를 내부에서 호출하므로 AuthGuard 내에서 호출해야 딥링크 리스너가 활성화됨. |

### 2.2 App.tsx 수정 방향

SetupGate와 AuthGuard를 분리하여 중첩한다. 기존 라우트 구조는 변경하지 않는다.

```tsx
// frontend/src/App.tsx (수정 후)
import { AuthGuard } from './components/auth/AuthGuard'

function App() {
  useEffect(() => {
    loadAppSettings()
    usePromptTemplateStore.getState().fetch()
  }, [])

  return (
    <SetupGate>
    <AuthGuard>
    <Routes>
      <Route path="/" element={<Navigate to="/meetings" replace />} />
      <Route path="/dashboard" element={<AppLayout><DashboardPage /></AppLayout>} />
      <Route path="/meetings" element={<AppLayout><MeetingsPage /></AppLayout>} />
      <Route path="/meetings/:id/live" element={<AppLayout><MeetingLivePage /></AppLayout>} />
      <Route path="/settings" element={<SettingsRedirect />} />
      <Route path="/meetings/:id" element={<AppLayout><MeetingPage /></AppLayout>} />
      <Route path="*" element={<Navigate to="/meetings" replace />} />
    </Routes>
    <SettingsModal />
    </AuthGuard>
    </SetupGate>
  )
}
```

#### 컴포넌트 중첩 순서

```
App
 └─ SetupGate         (1) 로컬 모드 전용: Tauri 프로덕션 환경 체크
     └─ AuthGuard     (2) 서버 모드 전용: 인증 체크
         └─ Routes    (3) 메인 라우트
```

- **SetupGate가 최외곽**: 로컬 모드에서 SetupPage(환경 확인/설치)가 먼저 완료되어야 한다. 서버 모드에서는 SetupGate가 needsSetup=false이므로 즉시 통과.
- **AuthGuard가 그 안쪽**: 서버 모드에서만 인증을 확인한다. 로컬 모드에서는 즉시 통과.
- 결과적으로 두 가드 중 하나만 활성화된다:
  - 로컬 모드: SetupGate만 동작, AuthGuard는 패스
  - 서버 모드: SetupGate는 패스, AuthGuard만 동작

### 2.3 config.ts 수정 방향

**현재 상태:** `getApiBaseUrl()`, `getWsUrl()` 함수가 이미 로컬/서버 모드 분기를 구현하고 있다. `API_BASE_URL`, `WS_URL` 상수도 하위 호환용으로 존재한다.

**변경 없음.** 이미 TSK-02-02에서 구현 완료. config.ts는 이번 태스크에서 수정하지 않는다.

### 2.4 모드별 동작 흐름

#### 로컬 모드 (기존 동작 유지)

```
앱 시작
 → SetupGate: needsSetup 판단
   → Tauri 프로덕션: SetupPage 표시 → 환경 확인 완료 → ready=true
   → 그 외: 즉시 통과
 → AuthGuard: getMode() !== 'server' → 즉시 통과
 → Routes 렌더링 (기존과 동일)
```

#### 서버 모드 + 미인증

```
앱 시작
 → SetupGate: Tauri 프로덕션이 아니거나, 이미 모드 설정 완료 → 통과
 → AuthGuard:
   → useAuth 실행: 토큰 없음 → isLoading=false, isAuthenticated=false
   → LoginPage 표시
   → 사용자가 "브라우저에서 로그인" 클릭
   → 브라우저 로그인 → 딥링크 콜백 → setTokens() → isAuthenticated=true
   → AuthGuard가 children(Routes) 렌더링
```

#### 서버 모드 + 인증 (앱 재시작)

```
앱 시작
 → SetupGate: 통과
 → AuthGuard:
   → useAuth 실행: localStorage에 토큰 있음 → isLoading=true
   → validateToken() 호출
     → 성공: markAuthenticated() → isLoading=false, isAuthenticated=true
     → 실패: refreshAccessToken() 시도
       → 갱신 성공: isAuthenticated=true
       → 갱신 실패: clearAuth() → LoginPage 표시
   → Routes 렌더링
```

---

## 3. 파일 변경 목록

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `frontend/src/components/auth/AuthGuard.tsx` | **신규** | 인증 가드 컴포넌트 |
| `frontend/src/App.tsx` | **수정** | AuthGuard import 추가, SetupGate 안에 AuthGuard 중첩 |

변경하지 않는 파일:
- `config.ts` -- 이미 구현 완료
- `authStore.ts` -- 기존 isAuthenticated/isLoading 그대로 사용
- `useAuth.ts` -- 기존 토큰 검증 로직 그대로 사용
- `LoginPage.tsx` -- AuthGuard에서 직접 렌더링하므로 변경 불필요
- `api/client.ts` -- JWT 헤더 첨부/리프레시 이미 구현

---

## 4. 고려사항

### 4.1 SetupGate와의 관계

SetupGate는 `IS_TAURI && !import.meta.env.DEV`일 때만 활성화된다. 서버 모드에서도 Tauri 프로덕션 빌드라면 SetupGate가 먼저 활성화될 수 있다. 하지만 서버 모드에서는 SetupPage에서 이미 "서버 연결" 모드를 선택하고 URL 설정을 마친 상태이므로, 이후 앱 재시작 시에도 SetupGate가 정상 통과한다.

현재 SetupGate는 모드와 무관하게 Tauri 프로덕션에서 항상 SetupPage를 보여주는데, 이 부분은 TSK-04-02 (SetupPage 모드 분기)에서 서버 모드일 때 SetupPage를 건너뛰도록 수정할 예정이다. 이번 태스크에서는 SetupGate를 수정하지 않는다.

### 4.2 LoginPage의 isLoading 분기 중복

LoginPage 내부에도 `isLoading` 체크가 있지만, AuthGuard가 상위에서 먼저 로딩을 처리하므로 LoginPage의 isLoading 분기에는 도달하지 않는다. LoginPage 측 로딩 UI는 제거하지 않는다 (단독 사용 가능성 유지).

### 4.3 useAuth 호출의 부작용

`useAuth`는 내부에서 `useDeepLink()`를 호출하여 딥링크 리스너를 등록한다. AuthGuard에서 useAuth를 호출하므로, 서버 모드에서 LoginPage가 표시될 때에도 딥링크 리스너가 활성화되어 있어 토큰 수신이 가능하다.

로컬 모드에서는 AuthGuard 내부의 `getMode() !== 'server'` 조건으로 조기 반환하지만, useAuth 훅은 이미 호출된 상태이므로 useDeepLink도 등록된다. 로컬 모드에서 useAuth의 useEffect는 `setLoading(false)`로 즉시 종료하므로 부작용 없다.

### 4.4 apiClient의 prefixUrl 갱신

`apiClient`는 `ky.create({ prefixUrl: getApiBaseUrl() })`로 모듈 로드 시점에 한 번 생성된다. ServerSetup 완료 후 모드/URL이 변경되면 `location.reload()` 등으로 앱을 리로드해야 apiClient가 새 URL을 반영한다. 이것은 이번 태스크 범위가 아니며, 이미 config.ts 주석에 명시되어 있다.
