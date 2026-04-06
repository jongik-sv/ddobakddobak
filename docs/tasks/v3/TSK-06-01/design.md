# TSK-06-01: SetupGate에 ServerSetup 모드 선택 통합 - 설계

## 현재 상태 분석

### 문제
- `ServerSetup` 컴포넌트가 `frontend/src/components/auth/ServerSetup.tsx`에 구현되어 있으나, 앱 플로우에 연결되어 있지 않다.
- `SetupGate`는 현재 `getMode()`를 호출하여 모드를 판단하지만, localStorage에 `mode` 키가 없는 첫 실행 시에도 기본값 `'local'`을 반환하여 곧바로 로컬 SetupPage로 진입한다.
- 사용자가 로컬/서버 모드를 선택할 기회가 없다.

### 현재 플로우 (Tauri 프로덕션)
```
SetupGate
  ├─ getMode() === 'server' → children (AuthGuard → App)
  └─ getMode() !== 'server' (즉, 'local') → SetupPage (환경 체크 + 서비스 시작)
```

- `getMode()`는 `localStorage.getItem('mode')`가 `'server'`가 아니면 항상 `'local'` 반환
- 첫 실행 시 localStorage에 mode가 없으므로 `'local'`로 판정 → SetupPage 바로 진입

### 목표 플로우
```
SetupGate
  ├─ mode 미설정 (첫 실행) → ServerSetup (모드 선택 화면)
  │   ├─ "로컬 실행" 선택 → localStorage에 mode='local' 저장 → SetupPage
  │   └─ "서버 연결" 선택 → URL 입력 + 헬스체크 → localStorage에 mode='server', server_url 저장 → children (AuthGuard → 로그인)
  ├─ mode === 'local' → SetupPage (기존 동작)
  └─ mode === 'server' → children (AuthGuard → App, 기존 동작)
```

## 구현 방향

### 핵심 원칙
1. **기존 컴포넌트 최대 재사용**: `ServerSetup`, `SetupPage`, `AuthGuard` 모두 그대로 사용
2. **변경 최소화**: `SetupGate.tsx`의 상태 머신만 확장하여 3단계 분기 처리
3. **config.ts에 헬퍼 추가**: `hasMode()` 함수로 "모드가 설정된 적 있는지" 판별
4. **설정에서 모드 변경**: SettingsContent에 모드 재설정 버튼 추가

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/config.ts` | `hasMode()` 헬퍼 함수 추가, `clearMode()` 함수 추가 | 수정 |
| `frontend/src/components/SetupGate.tsx` | 3단계 분기 로직 (미설정 → ServerSetup, local → SetupPage, server → children) | 수정 |
| `frontend/src/components/settings/SettingsContent.tsx` | 모드 재설정 버튼 섹션 추가 | 수정 |
| `frontend/src/components/__tests__/SetupGate.test.tsx` | 모드 미설정 시 ServerSetup 표시 테스트 추가 | 수정 |

## 주요 구조

### 1. config.ts 변경

```ts
// 기존
export function getMode(): 'local' | 'server' {
  const mode = localStorage.getItem('mode')
  return mode === 'server' ? 'server' : 'local'
}

// 추가
/** localStorage에 mode 키가 존재하는지 (한 번이라도 모드를 선택했는지) */
export function hasMode(): boolean {
  return localStorage.getItem('mode') !== null
}

/** 모드 설정을 초기화한다 (재설정 시 사용). */
export function clearMode(): void {
  localStorage.removeItem('mode')
  localStorage.removeItem('server_url')
}
```

- `hasMode()`는 `mode` 키 존재 여부만 확인한다. `getMode()`의 기본값 폴백 로직은 변경하지 않는다.
- `clearMode()`는 설정 화면에서 모드 재설정 시 호출한다.

### 2. SetupGate.tsx 변경

```tsx
import { useState } from 'react'
import { IS_TAURI, getMode, hasMode } from '../config'
import SetupPage from '../pages/SetupPage'
import { ServerSetup } from './auth/ServerSetup'

type Gate = 'mode_select' | 'local_setup' | 'ready'

export default function SetupGate({ children }: { children: React.ReactNode }) {
  const skipGate = !IS_TAURI || import.meta.env.DEV

  const initialGate = (): Gate => {
    if (skipGate) return 'ready'
    if (!hasMode()) return 'mode_select'          // 첫 실행: 모드 선택
    if (getMode() === 'server') return 'ready'     // 서버 모드: AuthGuard가 처리
    return 'local_setup'                            // 로컬 모드: 환경 체크
  }

  const [gate, setGate] = useState<Gate>(initialGate)

  if (gate === 'mode_select') {
    return (
      <ServerSetup
        onComplete={() => {
          // ServerSetup이 localStorage에 mode/server_url을 이미 저장한 상태
          if (getMode() === 'server') {
            setGate('ready')
          } else {
            setGate('local_setup')
          }
        }}
      />
    )
  }

  if (gate === 'local_setup') {
    return <SetupPage onReady={() => setGate('ready')} />
  }

  return <>{children}</>
}
```

**변경 요약:**
- 기존 `boolean` 상태(`ready`) → 3값 상태(`Gate` 타입)로 확장
- `hasMode() === false`일 때 `ServerSetup` 컴포넌트를 렌더링
- `ServerSetup.onComplete` 콜백에서 `getMode()` 결과에 따라 다음 단계 분기
- 서버 모드 선택 시 → `'ready'` (children 렌더링 → AuthGuard가 인증 처리)
- 로컬 모드 선택 시 → `'local_setup'` (SetupPage 렌더링 → 환경 체크 플로우)

### 3. SettingsContent.tsx 모드 재설정 섹션

SettingsContent의 최상단(STT 설정 위)에 현재 실행 모드 표시 및 재설정 버튼을 추가한다.

```tsx
// SettingsContent 내부, 최상단 섹션으로 추가

// import 추가
import { getMode, clearMode, IS_TAURI } from '../../config'

// 렌더링 (IS_TAURI일 때만 표시 — 웹 모드에서는 모드 선택이 불필요)
{IS_TAURI && (
  <section className="space-y-3 mb-8">
    <h3 className="text-sm font-semibold text-gray-800">실행 모드</h3>
    <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg">
      <div>
        <p className="text-sm font-medium text-gray-700">
          {getMode() === 'server' ? '서버 연결 모드' : '로컬 실행 모드'}
        </p>
        {getMode() === 'server' && (
          <p className="text-xs text-gray-500 mt-0.5">
            {localStorage.getItem('server_url') || ''}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          clearMode()
          window.location.reload()
        }}
        className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
      >
        모드 재설정
      </button>
    </div>
    <p className="text-xs text-gray-400">
      재설정 시 앱이 다시 시작되며 모드 선택 화면이 표시됩니다.
    </p>
  </section>
)}
```

**동작:**
- `clearMode()`로 localStorage에서 `mode`, `server_url` 제거
- `window.location.reload()`로 앱 전체를 리로드 → SetupGate가 `hasMode() === false`를 감지하여 모드 선택 화면 표시
- 서버 모드에서 모드 재설정 시 인증 토큰은 authStore에 남아 있으나, 모드 선택 후 다시 서버를 선택하면 기존 토큰으로 자동 로그인될 수 있다. 별도 토큰 클리어가 필요하면 `clearMode()` 내에서 `authStore.getState().clearAuth()`를 추가할 수 있으나, 이는 config.ts에서 store 의존을 만들므로, 버튼 onClick 핸들러에서 직접 처리하는 것이 더 깔끔하다.

### 4. ServerSetup 컴포넌트 — 변경 없음

`ServerSetup`은 현재 구현 그대로 사용한다:
- 모드 선택 UI (로컬/서버 카드)
- 서버 URL 입력 + 헬스체크
- `onComplete` 콜백 호출 전 localStorage에 `mode`, `server_url` 저장
- localStorage에 기존 값이 있으면 초기값으로 복원 (재설정 후 다시 진입해도 이전 선택 정보 불필요 — `clearMode()`가 이미 삭제)

### 5. AuthGuard — 변경 없음

`AuthGuard`는 `getMode() === 'server'`일 때만 인증을 검사하며, 이는 SetupGate에서 서버 모드를 선택 완료한 후에만 렌더링되므로 기존 로직이 정확히 맞는다.

## 데이터 흐름

```
[첫 실행]
  localStorage: mode=없음
  SetupGate → hasMode()=false → gate='mode_select' → ServerSetup 렌더링
    └─ 사용자가 "로컬 실행" + "시작하기" 클릭
       → localStorage.setItem('mode', 'local')
       → onComplete() 호출
       → SetupGate: getMode()='local' → setGate('local_setup')
       → SetupPage 렌더링 (환경 체크 → 서비스 시작)
       → onReady() → setGate('ready') → children 렌더링

[첫 실행 - 서버 모드]
  SetupGate → hasMode()=false → gate='mode_select' → ServerSetup 렌더링
    └─ 사용자가 "서버 연결" + URL 입력 + 헬스체크 성공 + "시작하기" 클릭
       → localStorage.setItem('mode', 'server')
       → localStorage.setItem('server_url', 'https://...')
       → onComplete() 호출
       → SetupGate: getMode()='server' → setGate('ready')
       → children 렌더링 (AuthGuard → 로그인 → App)

[재실행 - 로컬 모드 저장됨]
  localStorage: mode='local'
  SetupGate → hasMode()=true, getMode()='local' → gate='local_setup'
  → SetupPage 렌더링 (기존 동작 그대로)

[재실행 - 서버 모드 저장됨]
  localStorage: mode='server', server_url='https://...'
  SetupGate → hasMode()=true, getMode()='server' → gate='ready'
  → children 렌더링 (AuthGuard → 인증 확인 → App)

[설정에서 모드 재설정]
  SettingsContent: "모드 재설정" 클릭
  → clearMode() → localStorage에서 mode, server_url 삭제
  → window.location.reload()
  → SetupGate → hasMode()=false → gate='mode_select' → ServerSetup 렌더링
```

## 테스트 계획

### SetupGate.test.tsx 수정/추가

기존 mock에 `mockHasMode` 추가:

```ts
const { mockGetMode, mockHasMode } = vi.hoisted(() => ({
  mockGetMode: vi.fn(() => 'local' as 'local' | 'server'),
  mockHasMode: vi.fn(() => true),
}))

vi.mock('../../config', () => ({
  get IS_TAURI() { return mockIsTauri },
  getMode: mockGetMode,
  hasMode: mockHasMode,
}))

// ServerSetup 모킹 추가
vi.mock('../auth/ServerSetup', () => ({
  ServerSetup: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="server-setup">
      <button onClick={onComplete}>Complete</button>
    </div>
  ),
}))
```

**추가 테스트 케이스:**

1. **모드 미설정(첫 실행) 시 ServerSetup 표시**
   - `mockHasMode.mockReturnValue(false)`, `mockIsTauri=true`, `DEV=''`
   - `screen.getByTestId('server-setup')` 존재 확인

2. **모드 설정됨 + local 시 SetupPage 표시** (기존 테스트와 동일, `mockHasMode=true` 명시)

3. **모드 설정됨 + server 시 children 표시** (기존 테스트와 동일, `mockHasMode=true` 명시)

4. **웹 모드에서는 hasMode 무관하게 children 표시**
   - `mockIsTauri=false`, `mockHasMode.mockReturnValue(false)`
   - children이 바로 렌더링됨

5. **ServerSetup 완료 후 로컬 모드 선택 시 SetupPage로 전환**
   - `mockHasMode.mockReturnValue(false)` 상태에서 시작
   - Complete 버튼 클릭 후 `mockGetMode.mockReturnValue('local')` 설정
   - `screen.getByTestId('setup-page')` 확인

6. **ServerSetup 완료 후 서버 모드 선택 시 children으로 전환**
   - Complete 버튼 클릭 후 `mockGetMode.mockReturnValue('server')` 설정
   - children 렌더링 확인

### 기존 테스트 호환성

- 기존 SetupGate 테스트는 `mockHasMode`를 추가하고 기본값 `true`로 설정하면 기존 동작을 유지한다.
- ServerSetup.test.tsx는 변경 없음 (컴포넌트 자체는 수정하지 않으므로).
- AuthGuard.test.tsx는 변경 없음.

## 선행 조건

- 없음 (depends: -)
- `ServerSetup`, `SetupPage`, `AuthGuard`, `config.ts` 모두 이미 구현 완료 상태
